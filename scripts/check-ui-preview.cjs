'use strict';
// Actual pages backed only by explicitly authorized, temporary in-memory fixtures.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage']} : {}) });
  try {
    const page=await browser.newPage({reducedMotion:'reduce'}), errors=[], requests=[];
    const url=process.env.PREVIEW_URL || 'http://127.0.0.1:3000';
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if (/\/api\/|\/auth\/|googleapis|firebase|sharegram/i.test(r.url())) requests.push(r.url());});
    const go=async path=>{await page.goto(url+path,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);};
    const fits=async label=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' horizontal overflow');
    for(const width of [320,390,768,1024,1440,1920]) {
      await page.setViewportSize({width,height:900});
      for(const path of ['/','/performers','/performers/101','/admin/users','/admin/users/201','/audit-logs','/preview-notifications']) {await go(path); await fits(`${width} ${path}`);}
      for(const role of ['Review-only admin','User · Aoi']) {
        await page.getByRole('button',{name:role,exact:true}).click();
        await fits(`${width} ${role}`);
        assert.equal(await page.locator('a[href="/admin/users"]').count(),0);
      }
      assert.equal(await page.getByLabel('Open a sample application').locator('option').count(),4);
      console.log(`PASS ${width}px: seven actual pages and scoped perspectives`);
    }
    await go('/performers');
    await page.getByLabel('名前で検索').fill('田中');
    assert.equal(await page.locator('a[href="/performers/102"]').count(),0);
    await page.getByRole('button',{name:'フィルター',exact:true}).click();
    await page.getByLabel('審査ステータス').selectOption('active');
    await page.getByLabel('名前で検索').fill('');
    await page.locator('a[href="/performers/103"]').first().waitFor();
    await page.getByLabel('Open a sample application').selectOption('101');
    await page.getByRole('heading',{name:'Make a clear decision'}).waitFor();
    const confirm=page.getByRole('button',{name:'Confirm decision'});
    assert(await confirm.isDisabled());
    await page.getByRole('checkbox').check();await confirm.click();
    await page.getByText('Demo decision updated in memory only. No Sharegram or email message was sent.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Reset samples',exact:true}).click();
    await page.getByLabel('Open a sample application').selectOption('101');
    await page.getByRole('radio',{name:'Request correction',exact:true}).check();
    await page.getByRole('textbox',{name:/Reason/}).fill('DEMO: replace sample photo');
    await page.getByRole('checkbox').check();await confirm.click();
    await page.getByText('Demo decision updated in memory only. No Sharegram or email message was sent.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'User · Aoi',exact:true}).click();
    await page.getByLabel('Open a sample application').selectOption('101');
    await page.getByRole('button',{name:'Simulate resubmission',exact:true}).click();
    await page.waitForURL('**/performers');
    await page.getByRole('link',{name:'Demo inbox',exact:true}).click();
    await page.getByRole('button',{name:'Mark read',exact:true}).first().click();
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    const response=await page.request.post(url+'/api/performers/101/approve');assert.equal(response.status(),503);
    console.log('PASS: search/filter, approval, correction, owner resubmission, inbox; zero runtime errors/external API calls; server API writes blocked');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
