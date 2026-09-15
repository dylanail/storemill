import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';
import {captureCloneSource} from '../src/pages/clone-capture.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');

test('fresh mobile contexts preserve matched initial-UA-only media and keep visitor sessions isolated',async()=>{
  const requests=[];let upgrades=0;
  const server=createServer((request,response)=>{
    if(request.url.endsWith('.png')){response.writeHead(200,{'content-type':'image/png'});response.end(png);return;}
    requests.push({userAgent:request.headers['user-agent'],cookie:request.headers.cookie});const mobile=/Android.*Mobile/.test(request.headers['user-agent']||'');
    response.writeHead(200,{'content-type':'text/html','set-cookie':'source-visitor=fixture; Path=/'});
    response.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><img width="100" height="100" src="/${mobile?'mobile-only':'desktop'}.png"><script>new WebSocket('ws://'+location.host+'/no-socket-mutation').onerror=()=>{};</script></body></html>`);
  });
  server.on('upgrade',(_request,socket)=>{upgrades++;socket.destroy();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const result=await captureCloneSource('http://127.0.0.1:'+server.address().port+'/',{allowPrivateNetwork:true,timeoutMs:45000});
    assert.equal(upgrades,0);assert.equal(requests.length,3);assert.ok(requests.every(request=>!request.cookie));assert.match(requests[2].userAgent,/Android.*Mobile/);assert.match(requests[1].userAgent,/iPad/);
    assert.equal(result.captureReport.complete,true,JSON.stringify(result.captureReport));assert.match(result.html,/data-copy-desktop-src="[^"]*desktop\.png/);assert.match(result.html,/data-copy-mobile-src="[^"]*mobile-only\.png/);
    const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
    try { const page=await browser.newPage({viewport:{width:390,height:900}});await page.setContent(result.html.replace(/<script\b[\s\S]*?<\/script>/gi,''));await page.evaluate(()=>{window.__COPY_COMMERCE={scope:'page'};});await page.addScriptTag({content:readFileSync(new URL('../src/storefront/imported-responsive-media.js',import.meta.url),'utf8')});assert.match(await page.locator('img').getAttribute('src'),/mobile-only\.png$/);await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>document.querySelector('img').src.endsWith('/desktop.png')); } finally { await browser.close(); }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
