async function doFetchAndEvents(el, url, body, method, returnType) {
  try {
    const res = await fetch(url, {body, method});
    const eventType = res.status >= 200 && res.status < 300 ? "load" : "error";
    const detail = await res[returnType]();
    el.dispatchEvent(new CustomEvent(eventType, {bubbles: true, composed: true, detail}));
  } catch (err) {
    el.dispatchEvent(new CustomEvent("error", {bubbles: true, composed: true, detail: err}));
  }
}
