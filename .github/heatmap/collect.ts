// Collects the user's public commits for the last year, forks included, and buckets them by time.

const _API = 'https://api.github.com/graphql';

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(_API, {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

const _REPOS_QUERY = `query($login: String!, $after: String) {
  user(login: $login) {
    id
    repositories(first: 100, after: $after, privacy: PUBLIC, ownerAffiliations: OWNER) {
      nodes { nameWithOwner }
      pageInfo { hasNextPage endCursor }
    }
    contributionsCollection {
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner isPrivate }
      }
    }
  }
}`;

// Owned public repos (forks included) plus others' repos the user committed to.
async function listRepos(token: string, login: string): Promise<{ userId: string; repos: string[] }> {
  type Data = {
    user: {
      id: string;
      repositories: { nodes: { nameWithOwner: string }[]; pageInfo: PageInfo };
      contributionsCollection: {
        commitContributionsByRepository: { repository: { nameWithOwner: string; isPrivate: boolean } }[];
      };
    };
  };
  const repos = new Set<string>();
  let userId = '';
  let after: string | null = null;
  do {
    const { user }: Data = await gql<Data>(token, _REPOS_QUERY, { login, after });
    if (!user) throw new Error(`User not found: ${login}`);
    userId = user.id;
    for (const r of user.repositories.nodes) repos.add(r.nameWithOwner);
    for (const { repository: r } of user.contributionsCollection.commitContributionsByRepository) {
      if (!r.isPrivate) repos.add(r.nameWithOwner);
    }
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);
  return { userId, repos: [...repos] };
}

const _HISTORY_QUERY = `query($owner: String!, $name: String!, $author: ID!, $since: GitTimestamp!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, after: $after, author: { id: $author }, since: $since) {
            nodes { oid authoredDate }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }
}`;

type Commit = { oid: string; authoredDate: string };

async function repoCommits(token: string, repo: string, author: string, since: string): Promise<Commit[]> {
  type Data = {
    repository: {
      defaultBranchRef: { target: { history: { nodes: Commit[]; pageInfo: PageInfo } } } | null;
    } | null;
  };
  const [owner, name] = repo.split('/');
  const commits: Commit[] = [];
  let after: string | null = null;
  do {
    const data: Data = await gql<Data>(token, _HISTORY_QUERY, { owner, name, author, since, after });
    const history = data.repository?.defaultBranchRef?.target.history;
    if (!history) break; // Empty repo or no default branch.
    commits.push(...history.nodes);
    after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
  } while (after);
  return commits;
}

// YYYY-MM-DD of an instant in the given IANA timezone.
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

// "YYYY-MM-DD HH" (24h) of an instant in the given IANA timezone.
export function hourKey(date: Date, timeZone: string): string {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date);
  return `${dayKey(date, timeZone)} ${hour}`;
}

// Readable zone name and current offset, e.g. "Eastern Time (UTC-4)".
export function zoneLabel(date: Date, timeZone: string): string {
  const part = (timeZoneName: 'longGeneric' | 'shortOffset') =>
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName })
      .formatToParts(date).find((p) => p.type === 'timeZoneName')!.value;
  return `${part('longGeneric')} (${part('shortOffset').replace('GMT', 'UTC')})`;
}

// Per-key counts, e.g. `tally(commits, (d) => dayKey(d, tz))`.
export function tally(commits: Date[], key: (d: Date) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of commits) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1);
  return counts;
}

// The user's public commits in the last year (SHA + authored time), each SHA once.
export async function collect(token: string, login: string): Promise<{ oid: string; date: Date }[]> {
  const since = new Date(Date.now() - 372 * 86_400_000).toISOString(); // 53 weeks + slack.
  const { userId, repos } = await listRepos(token, login);
  // A fork shares SHAs with its upstream, so each commit counts once across all repos.
  const seen = new Set<string>();
  const commits: { oid: string; date: Date }[] = [];
  for (const repo of repos) {
    for (const c of await repoCommits(token, repo, userId, since)) {
      if (seen.has(c.oid)) continue;
      seen.add(c.oid);
      commits.push({ oid: c.oid, date: new Date(c.authoredDate) });
    }
  }
  return commits;
}
