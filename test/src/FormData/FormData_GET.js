function formDataToEncodedUri(href, formData) {
  const url = new URL(href, location);
  if (!formData)
    return url;
  for (let [k, v] of formData.entries()) {
    if (!(v instanceof String) && typeof v !== "string")
      throw TypeError("FormData with File/Blob entities cannot be encoded to uriComponent.");
    url.searchParams.set(k, v);
  }
  return url;
}

async function fetchAndEvent(attr, url, returnType, eventType) {
  try {
    const response = await fetch(url, {method: "GET"});
    if (!(response.status >= 200 && response.status < 300))
      throw `Failed to fetch "${url.href}": ${response.status} ${response.statusText}.`
    //todo here it is possible to manage res.status 3xx. For example.
    const detail = await response[returnType]();
    customEvents.dispatch(new CustomEvent(eventType, {detail}), attr.ownerElement);
  } catch (err) {
    const target = attr.ownerElement.isConnected ? attr.ownerElement : document.documentElement;//todo move this logic to the propagation algorithm??
    customEvents.dispatch(new ErrorEvent("error", {error: `${attr.name}: ${err}`}), target);
  }
}

export function FormData_GET(data, [returnType = "json"], eventType) {
  //1. get the formData. Fallback is the ownerElement being a <form> element.
  const formData =
    data instanceof FormData ? data :
      data.detail instanceof FormData ? data.detail :
        this.ownerElement instanceof HTMLFormElement ? new FormData(this.ownerElement) :
          undefined;
  //2. turn the formData into a URL. Fallback is the location of the document.
  const url = formDataToEncodedUri(this.value || location.href, formData);
  //3. react to the FormData url
  if (returnType === "json" || returnType === "text")
    fetchAndEvent(this, url, returnType, eventType);
  else if (returnType === "popstate")
    history.pushState(null, null, url.href), window.dispatchEvent(new PopStateEvent("popstate"));
  else if (returnType === "self" || returnType === "blank" || returnType === "parent" || returnType === "top")
    window.open(url, "_" + returnType);
}

export function JSON_GET(ar, [returnType = "self"], eventType) {
  const url = new URL(this.value, location);
  if(ar instanceof Event) ar = ar.detail;
  if (ar instanceof Array)
    for (let [k, v] of ar)
      url.searchParams.set(k, v);
  if (returnType === "text" || returnType === "json")
    fetchAndEvent(this, url, returnType, eventType);
  else if (returnType === "popstate")
    history.pushState(null, null, url), window.dispatchEvent(new PopStateEvent("popstate"));
  else if (["self", "blank", "parent", "top"].includes(returnType))
    open(url, "_" + returnType);
}