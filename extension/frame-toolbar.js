// The source frame owns the text model. Firefox routes the toolbar separately
// so the top document can render it even when the preview is cross-origin.
let hostedToolbar;
function readerToolbar(actions) {
  if (window === window.top) {
    hostedToolbar?.disconnect();
    return createReaderBar(actions);
  }
  const wire = browser.runtime.connect({name:"reader-toolbar"});
  const send = (method,...args) => wire.postMessage({method,args});
  let removed = false;
  wire.onMessage.addListener(({method,args}) => {
    if (!removed && Object.hasOwn(actions,method)) actions[method](...args);
  });
  wire.onDisconnect.addListener(() => {if (!removed) actions.close();});
  return {
    setState:(...args)=>send("setState",...args),
    setVoices:(...args)=>send("setVoices",...args),
    message:(...args)=>send("message",...args),
    dismissOptions() {send("escape"); return true;},
    remove() {removed = true; wire.disconnect();}
  };
}

if (window === window.top) {
  browser.runtime.onConnect.addListener(wire => {
    if (wire.name !== "reader-toolbar-host" || wire.sender?.id !== browser.runtime.id) return;
    hostedToolbar?.disconnect();
    const call = method => value => wire.postMessage({method,args:["rate","voice"].includes(method) ? [value] : []});
    const bar = createReaderBar(Object.fromEntries(["prev","next","toggle","close","rate","voice"].map(k=>[k,call(k)])));
    const host = {el:bar.host,disconnect:()=>wire.disconnect()};
    hostedToolbar = host;
    const escape = () => {if (!bar.dismissOptions()) call("close")();};
    function key(event) {
      if (event.key === "Escape") {event.stopPropagation(); escape();}
    }
    document.addEventListener("keydown",key,true);
    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      document.removeEventListener("keydown",key,true);
      bar.remove();
      if (hostedToolbar === host) hostedToolbar = null;
    }
    host.disconnect = () => {cleanup(); wire.disconnect();};
    wire.onDisconnect.addListener(cleanup);
    wire.onMessage.addListener(({method,args})=>{
      if (hostedToolbar !== host) return;
      if (method === "escape") escape();
      else if (["setState","setVoices","message"].includes(method)) bar[method](...args);
    });
  });
}
