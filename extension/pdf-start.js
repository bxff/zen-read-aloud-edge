(async () => {
  const app = window.PDFViewerApplication;
  await app.initializedPromise;
  const args = new URLSearchParams(location.search);
  const status = document.createElement("div");
  status.id = "readAloudPdfStatus";
  status.hidden = true;
  const surface = status.attachShadow({mode:"open"});
  const style = document.createElement("style");
  style.textContent = readerStateStyle;
  surface.append(style);
  const setState = createReaderState(surface);
  document.body.append(status);
  function report(message, busy = true) {
    setState(message,busy);
    status.hidden = !message;
  }
  let initialDocument = true;
  let port, requestId = 0, epoch = 0, autoPlay = args.has("play");
  const jobs = new Map();
  const controls = browser.runtime.connect({name:"pdf-controls"});
  controls.onMessage.addListener(msg => {
    if (pdfView.ready) readerController.activate(msg);
    else autoPlay = true;
  });

  function request(action, data = {}) {
    if (!port) {
      const current = browser.runtime.connectNative("com.readaloud.pdf");
      port = current;
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = null;
        for (const job of jobs.values()) job.reject(Error(current.error?.message || "PDF helper disconnected."));
        jobs.clear();
      });
      current.onMessage.addListener(msg => {
        const job = jobs.get(msg.id);
        if (!job) return;
        if (msg.progress) { report(msg.progress); return; }
        if (msg.chunk) {
          job.chunks.push(Uint8Array.from(atob(msg.chunk), c => c.charCodeAt(0)));
          return;
        }
        if (msg.page) {
          const raw = new Blob(job.chunks);
          job.chunks = [];
          job.pages.push(raw.text().then(JSON.parse));
          return;
        }
        jobs.delete(msg.id);
        if (msg.error) job.reject(Error(msg.error));
        else job.resolve(job);
      });
    }
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      jobs.set(id,{resolve,reject,chunks:[],pages:[]});
      port.postMessage({id, action, ...data});
    });
  }
  async function index(doc, ticket) {
    const data = await doc.getData();
    if (ticket !== epoch) return;
    await request("begin");
    for (let i=0; i<data.length; i+=196608) {
      if (ticket !== epoch) return;
      const bytes = data.subarray(i,i+196608);
      let binary = "";
      for (let k=0; k<bytes.length; k+=8192) binary += String.fromCharCode(...bytes.subarray(k,k+8192));
      await request("append",{chunk:btoa(binary)});
    }
    if (ticket !== epoch) return;
    const result = await request("finish");
    const pages = await Promise.all(result.pages);
    if (ticket !== epoch || doc !== app.pdfDocument) return;
    pages.forEach(pdfView.addPage);
    if (!pdfView.finish()) {readerController.close(); report("No readable text found. For image-only pages, install the OCR helper.",false); return;}
    report("");
    if (autoPlay) {
      autoPlay = false;
      const selection = args.get("selection");
      readerController.start(selection ? {selection} : null);
    }
  }
  app.eventBus.on("pagesinit", () => {
    const ticket = ++epoch;
    if (!initialDocument) readerController.close();
    initialDocument = false;
    pdfView.reset();
    report("Preparing PDF text…");
    index(app.pdfDocument,ticket).catch(err => {if (ticket===epoch) {readerController.close(); report(err.message,false);}});
  });
  for (const event of ["pagerendered","rotationchanging"]) app.eventBus.on(event, () => pdfView.redraw());
  if (!args.has("source")) { report(""); return; }
  if (autoPlay) readerController.prime();
  try {
    const url = new URL(args.get("source"));
    const filename = decodeURIComponent(url.pathname.split("/").pop()) || "Document.pdf";
    let data;
    if (url.protocol === "file:") {
      report("Opening local PDF…");
      const file = await request("readFile",{url:url.href});
      data = new Uint8Array(await new Blob(file.chunks).arrayBuffer());
    } else if (["https:","http:"].includes(url.protocol)) {
      report("Opening PDF…");
      const res = await fetch(url.href,{credentials:"include", referrerPolicy:"no-referrer"});
      if (!res.ok) throw Error("The PDF download returned HTTP " + res.status + ".");
      data = new Uint8Array(await res.arrayBuffer());
    } else throw Error("Choose a local or web PDF.");
    app.setTitleUsingUrl(filename);
    await app.open({data, filename, docBaseUrl:url.protocol === "file:" ? undefined : url.href});
  } catch (error) {
    readerController.close();
    report(error.message + " Use Open File in the PDF toolbar to choose a PDF.",false);
  }
})();
