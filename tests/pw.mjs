/* يحمّل Playwright من المسار العادي، أو من PLAYWRIGHT_MODULE إن حدّدته */
export const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
