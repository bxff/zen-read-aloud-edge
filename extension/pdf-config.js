document.addEventListener("webviewerloaded", () => {
  const options = window.PDFViewerApplicationOptions;
  options.set("defaultUrl", "");
  options.set("disablePreferences", true);
  options.set("enableScripting", false);
});
