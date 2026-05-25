/**
 * tools/release.ts — Deno 原生发布脚本
 *
 * 替代 release-it，纯 Deno 实现：
 * 1. 解析 conventional commits 推导版本号 (major/minor/patch)
 * 2. 更新 deno.json 版本号
 * 3. 更新 CHANGELOG.md
 * 4. 创建 git commit + tag + push
 * 5. 创建 GitHub Release
 *
 * 用法:
 *   deno run -A tools/release.ts                       # 正式发布
 *   deno run -A tools/release.ts --dry-run             # 预检
 *   deno run -A tools/release.ts --tag beta          # beta 发布
 *   deno run -A tools/release.ts --tag beta --dry-run  # beta 预检
 *
 * 前置条件:
 *   - gh CLI 已安装并认证 (gh auth status)
 *   - 在 main 分支上
 *   - 工作区干净
 */

const REPO = 'shenjingnan/zapmyco';
const REPO_URL = `https://github.com/${REPO}`;

type BumpType = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease';

const TYPE_LABELS: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  docs: 'Documentation',
  refactor: 'Code Refactoring',
  perf: 'Performance Improvements',
  test: 'Tests',
  chore: 'Chores',
  style: 'Styles',
};

interface Commit {
  hash: string;
  type: string | null;
  scope: string | null;
  description: string;
  isBreaking: boolean;
}

// ---- 工具函数 ----

function run(args: string[]): string {
  if (args.length === 0) throw new Error('run() 需要至少一个参数');
  const cmd = new Deno.Command(args[0]!, {
    args: args.slice(1),
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stdout, stderr } = cmd.outputSync();
  if (code !== 0) {
    throw new Error(
      `命令失败: ${args.join(' ')}\n${new TextDecoder().decode(stderr)}`,
    );
  }
  return new TextDecoder().decode(stdout).trim();
}

// ---- Git 操作 ----

function getLastTag(): string | null {
  try {
    return run([
      'git',
      'describe',
      '--tags',
      '--match',
      'v*',
      '--abbrev=0',
    ]);
  } catch {
    return null;
  }
}

function getCommitsSince(tag: string | null): Commit[] {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const raw = run([
    'git',
    'log',
    '--no-decorate',
    '--first-parent',
    range,
    '--pretty=format:%H|||%s',
  ]);
  if (!raw) return [];

  return raw.split('\n').filter(Boolean).map((line) => {
    const [hash, subject] = line.split('|||');
    const match = subject?.match(
      /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/,
    );

    // 检查 body 中是否包含 BREAKING CHANGE
    let isBreaking = match?.[3] === '!';
    if (!isBreaking && hash) {
      try {
        const body = run(['git', 'log', '--format=%b', '-1', hash]);
        isBreaking = /BREAKING\s+CHANGE/i.test(body);
      } catch {
        // ignore
      }
    }

    return {
      hash: hash?.slice(0, 7) ?? '???????',
      type: match?.[1] ?? null,
      scope: match?.[2] ?? null,
      description: match?.[4] ?? subject ?? '',
      isBreaking,
    };
  });
}

// ---- 版本推导 ----

function determineBump(
  commits: Commit[],
  tag?: string,
  currentVersion?: string,
): BumpType {
  if (tag && currentVersion?.includes('-')) return 'prerelease';
  const base = commits.some((c) => c.isBreaking)
    ? 'major'
    : commits.some((c) => c.type === 'feat')
    ? 'minor'
    : 'patch';
  return tag ? `pre${base}` as BumpType : base;
}

function bumpVersion(
  current: string,
  bump: BumpType,
  tag?: string,
): string {
  const [versionPart = '0.0.0', currentPre] = current.split('-');
  const [major = 0, minor = 0, patch = 0] = versionPart.split('.').map(Number);
  const preNum = currentPre ? parseInt(currentPre.split('.').pop() ?? '-1', 10) : -1;

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'premajor':
      return `${major + 1}.0.0-${tag ?? 'beta'}.0`;
    case 'preminor':
      return `${major}.${minor + 1}.0-${tag ?? 'beta'}.0`;
    case 'prepatch':
      return `${major}.${minor}.${patch + 1}-${tag ?? 'beta'}.0`;
    case 'prerelease':
      return `${major}.${minor}.${patch}-${tag ?? 'beta'}.${preNum + 1}`;
  }
}

// ---- CHANGELOG ----

function groupCommits(commits: Commit[]): Map<string, Commit[]> {
  const groups = new Map<string, Commit[]>();
  for (const c of commits) {
    if (!c.type) continue;
    const list = groups.get(c.type) ?? [];
    list.push(c);
    groups.set(c.type, list);
  }
  return groups;
}

function formatChangelogEntry(
  version: string,
  date: string,
  commits: Commit[],
  prevVersion?: string,
): string {
  const compareFrom = prevVersion ? `v${prevVersion}` : 'HEAD';
  const compareTo = `v${version}`;
  let md = `\n## [${version}](${REPO_URL}/compare/${compareFrom}...${compareTo}) (${date})\n`;

  const groups = groupCommits(commits);
  for (const [type, typeCommits] of groups) {
    const label = TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() +
        type.slice(1);
    md += `\n### ${label}\n\n`;
    for (const c of typeCommits) {
      const scope = c.scope ? `**${c.scope}:** ` : '';
      const prefix = c.isBreaking ? '⚠️  ' : '';
      md += `- ${prefix}${scope}${c.description} ([${c.hash}](${REPO_URL}/commit/${c.hash}))\n`;
    }
  }

  return md;
}

function updateChangelog(
  version: string,
  date: string,
  commits: Commit[],
  prevVersion: string,
): string {
  const changelog = Deno.readTextFileSync('CHANGELOG.md');
  const entry = formatChangelogEntry(version, date, commits, prevVersion);

  // Insert after "# Changelog\n\n"
  const headerEnd = changelog.indexOf('\n', changelog.indexOf('\n') + 1) + 1;
  let updated = changelog.slice(0, headerEnd) + entry + '\n' +
    changelog.slice(headerEnd);

  // Update [Unreleased] reference link
  const unreleasedRef = `[Unreleased]: ${REPO_URL}/compare/`;
  updated = updated.replace(
    new RegExp(`${unreleasedRef}v[^.]+\\.\\.\\.HEAD`),
    `${unreleasedRef}v${version}...HEAD`,
  );

  return updated;
}

// ---- 安装指引 ----

function formatInstallGuide(): string {
  return `

## 📦 安装方式

**一键安装（推荐）**:
\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.sh | sh
\`\`\`

**Windows PowerShell**:
\`\`\`powershell
iwr https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.ps1 -useb | iex
\`\`\`

**npm**:
\`\`\`bash
npx zapmyco
\`\`\`
`;
}

// ---- GitHub Release ----

async function createGitHubRelease(
  version: string,
  commits: Commit[],
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const notes = formatChangelogEntry(version, date, commits) +
    formatInstallGuide();

  const tmpFile = await Deno.makeTempFile({ suffix: '.md' });
  try {
    await Deno.writeTextFile(tmpFile, notes);
    const releaseArgs = [
      'gh',
      'release',
      'create',
      `v${version}`,
      '--title',
      `v${version}`,
      '--notes-file',
      tmpFile,
    ];
    if (version.includes('-')) releaseArgs.push('--prerelease');
    run(releaseArgs);
  } finally {
    await Deno.remove(tmpFile);
  }
}

// ---- 主流程 ----

async function main() {
  const isDryRun = Deno.args.includes('--dry-run');
  const tag = Deno.args.includes('--tag') ? Deno.args[Deno.args.indexOf('--tag') + 1] : undefined;

  // 前置检查
  if (!isDryRun) {
    try {
      const branch = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
      if (branch !== 'main' && branch !== 'master') {
        console.error(`错误: 当前在 ${branch} 分支，请在 main 分支上发布`);
        Deno.exit(1);
      }
      const status = run(['git', 'status', '--porcelain']);
      if (status) {
        console.error('错误: 工作区不干净，请先提交或 stash 当前改动');
        Deno.exit(1);
      }
      run(['gh', 'auth', 'status']);
    } catch (e) {
      console.error('前置检查失败:', (e as Error).message);
      Deno.exit(1);
    }
  }

  // 1. 读取当前版本
  const denoJson = JSON.parse(Deno.readTextFileSync('deno.json'));
  const currentVersion: string = denoJson.version;
  console.log(`  当前版本: v${currentVersion}`);

  // 2. 获取上一 tag 并解析 commits
  const lastTag = getLastTag();
  console.log(`  上一标签: ${lastTag ?? '(无)'}`);

  const commits = getCommitsSince(lastTag);
  if (commits.length === 0) {
    console.log('  没有新的 commit，无需发布');
    return;
  }
  console.log(`  新 commits: ${commits.length} 个`);

  // 3. 推导版本
  const bump = determineBump(commits, tag, currentVersion);
  const newVersion = bumpVersion(currentVersion, bump, tag);
  console.log(`  版本推导: ${bump} → v${newVersion}`);

  // 4. 打印 commits 摘要
  for (const c of commits) {
    const marker = c.isBreaking ? '⚠️ ' : '  ';
    console.log(`  ${marker}${c.hash} ${c.type ?? '?'}: ${c.description}`);
  }

  if (isDryRun) {
    console.log('\n  [DRY-RUN] 预检完成，跳过实际执行');
    return;
  }

  // 5. 更新 deno.json
  denoJson.version = newVersion;
  Deno.writeTextFileSync('deno.json', JSON.stringify(denoJson, null, 2) + '\n');
  console.log(`  ✓ deno.json 已更新`);

  // 6. 更新 CHANGELOG.md
  const today = new Date().toISOString().slice(0, 10);
  const updatedChangelog = updateChangelog(
    newVersion,
    today,
    commits,
    currentVersion,
  );
  Deno.writeTextFileSync('CHANGELOG.md', updatedChangelog);
  console.log(`  ✓ CHANGELOG.md 已更新`);

  // 7. Git commit + tag + push
  run(['git', 'add', '-A']);
  run(['git', 'commit', '-m', `chore(release): v${newVersion}`]);
  run(['git', 'tag', '-a', `v${newVersion}`, '-m', `v${newVersion}`]);
  run(['git', 'push', 'origin', 'HEAD', '--tags']);
  console.log(`  ✓ Git commit + tag v${newVersion} 已创建并推送`);

  // 8. GitHub Release
  await createGitHubRelease(newVersion, commits);
  console.log(`  ✓ GitHub Release v${newVersion} 已创建`);
  console.log(`\n  🎉 发布完成！GitHub Actions 将自动发布到 JSR 和 npm`);
}

if (import.meta.main) {
  await main();
}
