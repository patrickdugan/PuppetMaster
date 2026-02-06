function hasAnySelector(page, selectors) {
  return page.evaluate((sels) => sels.some((s) => document.querySelector(s)), selectors);
}

function normalizeUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function createReadOnlySiteModule(config) {
  const {
    id,
    domainHints,
    defaultUrl,
    checks,
  } = config;

  return {
    id,
    defaultUrl,
    async navigate(ctx) {
      await ctx.page.goto(ctx.targetUrl || defaultUrl, { waitUntil: 'domcontentloaded' });
      await ctx.page.waitForTimeout(1200);
    },
    async collectArtifacts(ctx) {
      const screenshot = await ctx.capture(`01-${id}.png`);
      return { screenshot };
    },
    async runChecks(ctx) {
      const findings = [];
      const host = normalizeUrl(ctx.page.url());
      const domainOk = domainHints.some((d) => host.includes(d));
      findings.push({
        id: 'domain_match',
        status: domainOk ? 'pass' : 'warn',
        message: domainOk ? `Host matches ${id}` : `Unexpected host: ${host || '(empty)'}`,
      });

      for (const check of checks) {
        const ok = await hasAnySelector(ctx.page, check.selectors);
        findings.push({
          id: check.id,
          status: ok ? 'pass' : 'warn',
          message: ok ? check.pass : check.warn,
        });
      }
      return findings;
    },
  };
}
