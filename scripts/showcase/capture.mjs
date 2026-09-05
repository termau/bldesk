import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url)
const { _electron:electron }=await import(process.env.BLDESK_PLAYWRIGHT_MODULE||'playwright')
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const app=await electron.launch({executablePath:require('electron'),args:[resolve(root,'scripts/showcase/launcher.cjs')],timeout:30000})
try{
  const page=await app.firstWindow();page.setDefaultTimeout(15000)
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Renderer error',e.message)})
  await page.getByText('edge-web-syd-01',{exact:true}).first().waitFor()
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1600,1000);w.webContents.setZoomFactor(1)})
  const deep=url=>page.evaluate(url=>window.dispatchEvent(new CustomEvent('bldesk:local-deep-link',{detail:url})),url)
  const theme=dark=>page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark)
  const shot=async name=>{
    await page.waitForTimeout(1600)
    const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(resolve(root,'docs/screenshots',name+'.png'),Buffer.from(data,'base64'))
    console.log('Captured',name)
  }
  await theme(true);await page.getByTitle('Grid View').click();await shot('dashboard-dark')
  await deep('bldesk://tab/map');await page.waitForTimeout(1200);await page.getByTitle('Zoom in',{exact:true}).click()
  await page.mouse.move(1400,800);await page.mouse.wheel(-150,-100);await shot('network-map-dark')
  await deep('bldesk://tab/heatmap');await page.getByRole('cell',{name:/edge-web-syd-01/}).waitFor();await shot('heatmap-dark')
  await theme(false);await deep('bldesk://tab/firewall');await page.getByRole('button',{name:'Fleet matrix',exact:true}).click();await shot('firewall-light')
  await deep('bldesk://server/8102/backups');await page.getByText('Before database upgrade',{exact:true}).waitFor();await shot('backups-light')
  await theme(true);await deep('bldesk://server/8101/usage');await shot('usage-showcase-dark')
  await deep('bldesk://tab/templates');await shot('templates-dark')
  await deep('bldesk://help/firewall');await shot('help-dark')
  await theme(false);await shot('help-light')
  assert.deepEqual(errors,[])
  const report=await app.evaluate(()=>global.showcase)
  assert.equal(report.blockedWrites,0)
  console.log('PASS: real Electron screenshots, isolated synthetic profile; HTTP fully intercepted.',JSON.stringify({requests:report.requests.length,blockedWrites:report.blockedWrites,userData:report.userData}))
}finally{await app.close()}
