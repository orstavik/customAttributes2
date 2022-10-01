async function doFetchAndEvents(el, url, body, returnType) {
  try {
    const res = await fetch(url, {body, method: "POST"});
    const eventType = res.status >= 200 && res.status < 300 ? "load" : "error";
    const detail = await res[returnType]();
    el.dispatchEvent(new CustomEvent(eventType, {bubbles: true, composed: true, detail}));
  } catch (err) {
    el.dispatchEvent(new CustomEvent("error", {bubbles: true, composed: true, detail: err}));
  }
}

function openForm(href, target, enctype, nameValues) {
  //todo how to handle the formData??
  const form = document.createElement("form");
  form.method = "POST";
  form.action = href;
  form.target = target;
  form.enctype = enctype;
  form.style.display = "none";

  for (let [name, value] of nameValues) { //todo formData instead of nameValues
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

function reactToUrl(attr, formData, returnType, url, eventType) {
  if (returnType === "json" || returnType === "text")
    doFetchAndEvents(attr.ownerElement, url, returnType, eventType);
  else if (returnType === "self" || returnType === "blank" || returnType === "parent" || returnType === "top")
    openForm(url, "_" + returnType, "multipart/form-data", formData);
}

export function merge_searchParams_into_FormData(data) {
  const formData =
    data instanceof FormData ? data :
      data.detail instanceof FormData ? data.detail :
        this.ownerElement instanceof HTMLFormElement ? new FormData(this.ownerElement) :
          new FormData();
  const url = new URL(this.value, location);
  for (let [k, v] of url.searchParams.entries())
    formData.append(k, v);
  return formData;
}

//method_target_enctype_Attr
export function POST_json_formdata_Attr(data, eventType, returnType) {
  //1. get the formData. Fallback is the ownerElement being a <form> element.
  //2. turn the formData into a URL. Fallback is the location of the document.
  const formData =
    data instanceof FormData ? data :
      data.detail instanceof FormData ? data.detail :
        this.ownerElement instanceof HTMLFormElement ? new FormData(this.ownerElement) :
          undefined;
  //handle differently based on the returnType
  reactToUrl(this, formData, returnType, new URL(this.value, location), "load"/*eventType*/);
  // doFetchAndEvents(this.ownerElement, url, formData, returnType, "load"/*eventType*/);
}

//todo this is more or less useless
export function POST_json_uriComponent_Attr({detail: entries}, [returnType]) {
  const url = new URL(this.value, location);
  for (let [k, v] of entries)
    url.searchParams.append(k, v);
  const body = url.searchParams.toString();
  for (let k of url.searchParams.keys())
    url.searchParams.delete(k);
  //handle differently based on the returnType
  doFetchAndEvents(this.ownerElement, url, body, "post", returnType);
}

//
// //todo the Post form data are untested.
// function POSTAttr(target = "_self", enctype = "application/x-www-form-urlencoded") {
//   return function POSTAttr({detail: entries}) {
//     const url = new URL(this.value);
//     const body = [...entries, ...url.searchParams.entries()];
//     for (let k of url.searchParams.keys())
//       url.searchParams.delete(k);
//     openForm(url, target, enctype, body);
//   }
// }
//
// export const POST_uriComponent_Attr = POSTAttr();
// export const POST__blank_uriComponent_Attr = POSTAttr("_blank");
// export const POST__parent_uriComponent_Attr = POSTAttr("_parent");
// export const POST__top_uriComponent_Attr = POSTAttr("_top");
//
// export const POST_formdata_Attr = POSTAttr("_self", "multipart/form-data");
// export const POST__blank_formdata_Attr = POSTAttr("_blank", "multipart/form-data");
// export const POST__parent_formdata_Attr = POSTAttr("_parent", "multipart/form-data");
// export const POST__top_formdata_Attr = POSTAttr("_top", "multipart/form-data");