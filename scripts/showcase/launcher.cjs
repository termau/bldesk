// Documentation-only Electron launcher. Never reads the user's vault or sends HTTP.
const { app, ipcMain, session } = require('electron')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const root = join(__dirname, '../..')
// Optional directory used by the isolated terminal restart smoke test only.
const dir = process.env.BLDESK_TEST_USER_DATA || mkdtempSync(join(tmpdir(), 'bldesk-showcase-'))
app.setPath('userData', dir)
app.setPath('sessionData', dir)
app.setVersion(require(join(root, 'package.json')).version)
const regions = ['Sydney', 'Brisbane', 'Melbourne'].map((name,i)=>({name,slug:['syd','bne','mel'][i],available:true,features:[],sizes:[]}))
const images = ['Ubuntu','Debian','AlmaLinux'].map((distribution,i)=>({id:101+i,slug:['ubuntu-24.04','debian-12','almalinux-9'][i],name:['Ubuntu 24.04 LTS','Debian 12','AlmaLinux 9'][i],full_name:['Ubuntu 24.04 LTS','Debian 12','AlmaLinux 9'][i],distribution,public:true,regions:regions.map(r=>r.slug),min_disk_size:10,min_memory_megabytes:512}))
const sizes = [2,4,8,16].map(n=>({slug:`std-${n}`,description:`${n} vCPU`,size_type:{slug:'vps',name:'Standard'},available:true,regions:regions.map(r=>r.slug),price_monthly:n*12,price_hourly:n/60,memory:n*2048,disk:n*40,vcpus:n,transfer:n,options:{disk_min:10,disk_max:1000,memory_max:65536,ipv4_addresses_max:8,daily_backups:3,weekly_backups:2,monthly_backups:1}}))
const roles=['edge-web','api','postgres','queue-worker','redis','observability']
const servers=Array.from({length:18},(_,i)=>{
  const region=regions[Math.floor(i/6)],role=roles[i%6],size=sizes[(i%6===2)?2:(i%3)]
  return {id:8100+i,name:`${role}-${region.slug}-01`,status:'active',memory:size.memory,disk:size.disk,vcpus:size.vcpus,region,image:images[i%3],size,size_slug:size.slug,vpc_id:901+Math.floor(i/6),selected_size_options:{memory:size.memory,disk:size.disk,ipv4_addresses:1,daily_backups:3,weekly_backups:2,monthly_backups:1},networks:{v4:[{ip_address:`${['192.0.2','198.51.100','203.0.113'][Math.floor(i/6)]}.${20+i%6}`,type:'public',netmask:'255.255.255.0',gateway:'192.0.2.1'},{ip_address:`10.${20+Math.floor(i/6)}.0.${10+i%6}`,type:'private',netmask:'255.255.0.0'}],v6:[]},features:['backups'],backup_ids:[7101,7102,7103],created_at:'2026-08-01T00:00:00Z'}
})
const vpcs=regions.map((r,i)=>({id:901+i,name:`production-${r.slug}`,ip_range:`10.${20+i}.0.0/16`,description:'Demo application network'}))
const lbs=regions.map((r,i)=>({id:950+i,name:`edge-${r.slug}.example.com`,ip:`${['192.0.2','198.51.100','203.0.113'][i]}.10`,region:r,status:'active',server_ids:[8100+i*6,8101+i*6],forwarding_rules:[{entry_protocol:'https',entry_port:443,target_protocol:'https',target_port:443}],health_check:{protocol:'https',path:'/health'}}))
const firewall=id=>[
  {description:'Operations SSH via management host',protocol:'tcp',source_addresses:['192.0.2.25/32'],destination_ports:['22'],action:'accept'},
  ...((id-8100)%6<2?[{description:'Public HTTPS',protocol:'tcp',source_addresses:['0.0.0.0/0'],destination_ports:['443'],action:'accept'}]:[]),
  ...((id-8100)%6===2?[{description:'PostgreSQL from application network',protocol:'tcp',source_addresses:['10.0.0.0/8'],destination_ports:['5432'],action:'accept'}]:[]),
  ...((id-8100)%6===4?[{description:'Redis from application network',protocol:'tcp',source_addresses:['10.0.0.0/8'],destination_ports:['6379'],action:'accept'}]:[]),
  {description:'Node exporter from monitoring',protocol:'tcp',source_addresses:['192.0.2.25/32'],destination_ports:['9100'],action:'accept'},
  {description:'Default deny',protocol:'all',action:'drop'}
]
const sample=(id,offset=0)=>{
  const s=servers.find(s=>s.id===id)||servers[0],i=id-8100,ratio=[.36,.62,.81,.94,.25,.48][Math.abs(i)%6]
  const wave=1+Math.sin(offset*.32+i)*.2
  return {period:{start:new Date(Date.now()-(offset+1)*300000).toISOString(),end:new Date(Date.now()-offset*300000).toISOString()},average:{cpu_usage_percent:s.vcpus*100*ratio*wave,cpu_usage_detailed:Array(s.vcpus).fill(100*ratio*wave),memory_usage_bytes:s.memory*1024**2*ratio,storage_usage_megabytes:s.disk*1024*(.35+ratio*.4),network_incoming_kbps:2500+ratio*18000*wave,network_outgoing_kbps:1200+ratio*14000*wave,storage_read_kbps:1000+ratio*23000*wave,storage_write_kbps:800+ratio*15000*wave,storage_read_iops:300+ratio*1500,storage_write_iops:100+ratio*900}}
}
const profile={id:'showcase-demo',name:'Atlas · Demo Fleet',email:'operator@example.com',token:'synthetic-not-a-token',createdAt:'2026-08-01T00:00:00Z'}
global.showcase={blockedWrites:0,requests:[],userData:dir}
app.whenReady().then(()=>{
  const handler=async request=>{
    const u=new URL(request.url),p=u.pathname
    global.showcase.requests.push(`${request.method} ${u.hostname}${p}`)
    if(request.method!=='GET'){global.showcase.blockedWrites++;return new Response('{}',{status:405})}
    let body={actions:[],backups:[],vpcs:[],load_balancers:[],domains:[],ssh_keys:[],invoices:[],software:[],licensed_software:[],threshold_alerts:[]}
    const id=Number(p.match(/(?:servers|samplesets)\/(\d+)/)?.[1]||8100)
    if(p==='/v2/servers')body={servers,meta:{total:servers.length}}
    else if(/^\/v2\/servers\/\d+$/.test(p))body={server:servers.find(s=>s.id===id)}
    else if(p==='/v2/regions')body={regions}
    else if(p==='/v2/sizes')body={sizes,meta:{total:sizes.length}}
    else if(p==='/v2/images')body={images,meta:{total:images.length}}
    else if(p.endsWith('/advanced_firewall_rules'))body={firewall_rules:firewall(id)}
    else if(p==='/v2/vpcs')body={vpcs}
    else if(p.endsWith('/members')){const v=Number(p.split('/')[3]);body={members:servers.filter(s=>s.vpc_id===v).map(s=>({resource_id:s.id,resource_type:'server'}))}}
    else if(p==='/v2/load_balancers')body={load_balancers:lbs}
    else if(p.startsWith('/v2/load_balancers/'))body={load_balancer:lbs.find(l=>l.id===Number(p.split('/')[3]))}
    else if(p.includes('/samplesets/'))body=p.endsWith('/latest')?{sample_set:sample(id)}:{sample_sets:Array.from({length:288},(_,i)=>sample(id,287-i)),meta:{total:288}}
    else if(p.endsWith('/backups'))body={backups:['Before database upgrade','Nightly · production baseline','Weekly · recovery checkpoint','Monthly · August archive'].map((name,i)=>({id:7101+i,name,created_at:new Date(Date.now()-(i+1)*86400000).toISOString(),min_disk_size:160,type:'backup',backup_type:['temporary','daily','weekly','monthly'][i],status:'available',size_gigabytes:160}))}
    else if(p.endsWith('/balance'))body={balance:{available_credit:2480,balance:2480,unbilled_total:684.2}}
    else if(p.endsWith('/account'))body={account:{email:'operator@example.com',status:'active',email_verified:true,two_factor_authentication_enabled:true,configured_payment_methods:['credit-card'],additional_ipv4_limit:64,tax_code:{name:'GST',fixed_percent:10}}}
    else if(p.endsWith('/user_data'))body={user_data:'#cloud-config\npackages:\n  - nginx\n  - prometheus-node-exporter\n'}
    return Response.json(body)
  }
  session.defaultSession.protocol.handle('https',handler)
  session.defaultSession.protocol.handle('http',handler)
})
import(pathToFileURL(process.env.BLDESK_TEST_MAIN || join(root,'out/main/index.js')).href).then(()=>app.whenReady()).then(()=>{
  const values={'vault:getProfiles':[profile],'vault:getActiveProfile':profile,'vault:getLocalSshKeys':[],'system:sendNotification':false,'net:probeTcp':{ok:true,latencyMs:8},'net:probePing':{ok:true,latencyMs:8},'net:setTargets':undefined}
  for(const [name,value] of Object.entries(values)){ipcMain.removeHandler(name);ipcMain.handle(name,()=>value)}
  if (process.env.BLDESK_TEST_KEY) {
    ipcMain.removeHandler('vault:getLocalSshKeys')
    ipcMain.handle('vault:getLocalSshKeys', () => [{ name: 'Disposable test key', privateKeyPath: process.env.BLDESK_TEST_KEY, publicKey: '' }])
    ipcMain.removeHandler('terminal:launchNative')
    ipcMain.handle('terminal:launchNative', (_event, options) => {
      global.showcase.nativeLaunches = [...(global.showcase.nativeLaunches || []), options]
      return { success: true, terminal: 'smoke-test native stub' }
    })
  }
})
