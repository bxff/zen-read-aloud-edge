const extension = browser;
let activeClient = null;
const pdfControls = new Map();
const pdfPageURL = extension.runtime.getURL("pdfjs/web/viewer.html");
const frameByTab = new Map();

extension.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "speech-settings" && sender.id === extension.runtime.id) return extension.runtime.openOptionsPage();
  if (sender.tab && message.type === "frame") frameByTab.set(sender.tab.id, sender.frameId);
});
extension.tabs.onRemoved.addListener(id => frameByTab.delete(id));
extension.tabs.onUpdated.addListener((id, change) => {
  if (change.status === "loading") frameByTab.delete(id);
});

extension.runtime.onConnect.addListener(client => {
  if (client.name === "reader-toolbar" && client.sender.id === extension.runtime.id && client.sender.tab && client.sender.frameId > 0) {
    const host = extension.tabs.connect(client.sender.tab.id,{frameId:0,name:"reader-toolbar-host"});
    client.onMessage.addListener(message=>host.postMessage(message));
    host.onMessage.addListener(message=>client.postMessage(message));
    client.onDisconnect.addListener(()=>host.disconnect());
    host.onDisconnect.addListener(()=>client.disconnect());
    return;
  }
  if (client.name === "pdf-controls" && client.sender.url?.split(/[?#]/)[0] === pdfPageURL) {
    const tabId = client.sender.tab?.id;
    pdfControls.set(tabId, client);
    client.onDisconnect.addListener(() => {
      if (pdfControls.get(tabId) === client) pdfControls.delete(tabId);
    });
    return;
  }
  if (client.name !== "read-aloud" || client.sender.id !== extension.runtime.id) return;
  activeClient?.close();
  const dispose = openVoiceSession(client);
  const session = {close() { dispose(); client.disconnect(); }};
  activeClient = session;
  client.onDisconnect.addListener(() => {
    dispose();
    if (activeClient === session) activeClient = null;
  });
});

extension.menus.create({ id: "read-here", title: "Read aloud from here", contexts: ["page", "link", "frame"] });
extension.menus.create({ id: "read-selection", title: "Read aloud selection", contexts: ["selection"] });
async function isPDF(url) {
  if (!url || !/^(https?|file):/.test(url)) return false;
  if (/\.pdf$/i.test(new URL(url).pathname)) return true;
  if (!/^https?:/.test(url)) return false;
  try {
    const response = await fetch(url, {method: "HEAD", credentials: "include"});
    return response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "application/pdf";
  } catch { return false; }
}
async function activate(tab, type, frameId, selection = "") {
  if (!tab) return;
  const viewer = pdfControls.get(tab.id);
  if (viewer) { viewer.postMessage({type}); return; }
  try {
    const send = frame => extension.tabs.sendMessage(tab.id, {type}, {frameId: frame});
    try { await send(frameId || 0); }
    catch (error) { if (!frameId) throw error; await send(0); }
    await extension.browserAction.setBadgeText({tabId: tab.id, text: ""});
    await extension.browserAction.setTitle({tabId: tab.id, title: "Read Aloud"});
  } catch {
    if (await isPDF(tab.url)) {
      const args = new URLSearchParams({source: tab.url, play: "1"});
      if (selection) args.set("selection", selection);
      await extension.tabs.update(tab.id, {url: pdfPageURL + "?" + args + new URL(tab.url).hash});
      await extension.browserAction.setBadgeText({tabId: tab.id, text: ""});
      return;
    }
    await extension.browserAction.setBadgeText({tabId: tab.id, text: "!"});
    await extension.browserAction.setTitle({tabId: tab.id, title: "Open or reload a web page to read aloud."});
  }
}
extension.menus.onClicked.addListener((info, tab) => activate(tab, info.menuItemId, info.frameId, info.selectionText));
extension.commands.onCommand.addListener(async () => {
  const [tab] = await extension.tabs.query({active: true, currentWindow: true});
  if (tab) await activate(tab, "toggle", frameByTab.get(tab.id));
});
extension.browserAction.onClicked.addListener(tab => activate(tab, "toggle", frameByTab.get(tab.id)));
