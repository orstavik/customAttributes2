//todo rename to navigationLib.js
export function extractFormData(data) {
  return data instanceof FormData ? data :
    data.detail instanceof FormData ? data.detail :
      this.ownerElement instanceof HTMLFormElement ? new FormData(this.ownerElement) :
        undefined;
}

export function formDataToUri(formData) {
  const url = new URL(this.value, location);
  if (formData instanceof FormData) {
    for (let [k, v] of formData.entries()) {
      if (!(v instanceof String) && typeof v !== "string")
        throw TypeError("FormData with File/Blob entities cannot be encoded to uriComponent.");
      url.searchParams.set(k, v);
    }
  }
  return url;
}

export function encodeUriFromJson(ar) {
  const url = new URL(this.value, location);
  if (ar instanceof Event)
    ar = ar.detail;
  if (ar instanceof Array)
    for (let [k, v] of ar)
      url.searchParams.set(k, v);
  return url;
}

export async function fetchAndEvent(url, returnType, eventType) {
  try {
    const response = await fetch(url, {method: "GET"});
    if (!(response.status >= 200 && response.status < 300))
      throw `Failed to fetch "${url.href}": ${response.status} ${response.statusText}.`
    //todo here it is possible to manage res.status 3xx. For example.
    const detail = await response[returnType]();
    eventLoop.dispatch(new CustomEvent(eventType, {detail}), this.ownerElement);
  } catch (err) {
    const target = this.ownerElement.isConnected ? this.ownerElement : document.documentElement;
    //todo move this logic to the propagation algorithm??
    eventLoop.dispatch(new ErrorEvent("error", {error: `${this.name}: ${err}`}), target);
  }
}

export function popstate(url) {
  history.pushState(null, null, url.href), window.dispatchEvent(new PopStateEvent("popstate"));
}

export function open(url, _, returnType = "self") {
  window.open(url, "_" + returnType);
}

function enctypeTail(enctype) {
  if (enctype === "multipart") return "/form-data";
  if (enctype === "application") return "/x-www-form-urlencoded";
  if (enctype === "text") return "/plain";
  throw new SyntaxError(`Unknown enctype: "${enctype}". Known enctypes are "application", "multipart", and "text".`);
}

export function openPost({href, withEntries}, _, target = "self", enctype = "multipart") {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = href;
  form.target = `_${target}`;
  form.enctype = enctype + enctypeTail(enctype);
  form.style.display = "none";

  for (let [name, value] of withEntries.entries()) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}


//todo below are essentially shortcuts. How to make these syntactical in HTML?
// To make them syntactical in JS is essentially not that interesting, that can be done in JS.
// The shortcut mainly has value if it is done using
// a standard set of html defined reactions and custom attributes.

export function reactToUrl(url, eventType, returnType) {
  if (returnType === "json" || returnType === "text")
    fetchAndEvent.call(this, url, returnType, eventType);
  else if (returnType === "popstate")
    popstate(url);
  else if (returnType === "self" || returnType === "blank" || returnType === "parent" || returnType === "top")
    open(url, returnType);
}

export function FormData_GET(data, eventType, returnType = "json") {
  const formData = extractFormData.call(this, data);
  const url = formDataToUri.call(this, formData);
  return reactToUrl.call(this, url, eventType, returnType);
}

export function JSON_GET(ar, eventType, returnType = "self") {
  const url = encodeUriFromJson.call(this, ar);
  return reactToUrl.call(this, url, eventType, returnType);
}