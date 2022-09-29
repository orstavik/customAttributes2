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

function openForm(href, target, enctype, nameValues) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = href;
    form.target = target;
    form.enctype = enctype;
    form.style.display = "none";

    for (let [name, value] of nameValues) {
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

//receives: [ [key, value], [key2, value2], [key, value2] ]. An entry map.

function formDataToEncodedUri(formData, base, href) {
    const url = new URL(href, base);
    if (!formData)
        return url;
    for (let [k, v] of formData.entries()) {
        if (!(v instanceof String) && typeof v !== "string")
            throw TypeError("FormData with File/Blob entities cannot be encoded to uriComponent here.");
        url.searchParams.set(k, v);
    }
    return url;
}

export const GetFormDataJSON = function (e) {
    const formData = e.detail;
    const url = formDataToEncodedUri(formData, location, this.value);
    doFetchAndEvents(this.ownerElement, url, null, "GET", "json");
}

export class GetFormDataText extends Attr {
    onEvent({detail: formData}) {
        const url = formDataToEncodedUri(formData, location, this.value);
        doFetchAndEvents(this.ownerElement, url, null, "GET", "text");
    }
}

function GETAttr(returnType = "_self") {
    return class AjaxAttr extends Attr {
        onEvent({detail: formData}) {
            const url = formDataToEncodedUri(formData, location, this.value);
            if (returnType === "text" || returnType === "json")
                doFetchAndEvents(this.ownerElement, url, null, "GET", returnType);
            else if (["_self", "_blank", "_parent", "_top"].includes(returnType))
                open(url, returnType);
            else if (returnType === "history")
                history.pushState({}, null, url), window.dispatchEvent(new Event("popstate"));
        }
    }
}

function POSTFormDataAttr(returnType) {             //formdata is only useful for POST
    return class AjaxAttr extends Attr {
        onEvent({detail: entries}) {
            const url = new URL(this.value);
            const formData = new FormData();
            for (let [name, value] of entries)
                formData.append(name, value);
            for (let [k, v] of url.searchParams.entries())
                formData.append(k, v);
            for (let k of url.searchParams.keys())
                url.searchParams.delete(k);
            doFetchAndEvents(this.ownerElement, url, formData, "POST", returnType);
        }
    }
}

function POSTUrlEncodedAttr(returnType) {
    return class AjaxAttr extends Attr {
        onEvent({detail: entries}) {
            const url = new URL(this.value);
            for (let [k, v] of entries)
                url.searchParams.append(k, v);
            const body = url.searchParams.toString();
            for (let k of url.searchParams.keys())
                url.searchParams.delete(k);
            doFetchAndEvents(this.ownerElement, url, body, "post", returnType);
        }
    }
}

function POSTAttr(target = "_self", enctype = "application/x-www-form-urlencoded") {
    return class AjaxAttr extends Attr {
        onEvent({detail: entries}) {
            const url = new URL(this.value);
            const body = [...entries, ...url.searchParams.entries()];
            for (let k of url.searchParams.keys())
                url.searchParams.delete(k);
            openForm(url, target, enctype, body);
        }
    }
}

//method_target_enctype_Attr

export const GET_Attr = GETAttr();
export const GET_text_Attr = GETAttr("text");
export const GET_json_Attr = GETAttr("json");
export const GET_history_Attr = GETAttr("history");
export const GET__blank_Attr = GETAttr("_blank");
export const GET__parent_Attr = GETAttr("_parent");
export const GET__top_Attr = GETAttr("_top");

export const POST_text_formdata_Attr = POSTFormDataAttr("text");
export const POST_json_formdata_Attr = POSTFormDataAttr("json");

export const POST_text_uriComponent_Attr = POSTUrlEncodedAttr("text");
export const POST_json_uriComponent_Attr = POSTUrlEncodedAttr("json");

//todo the Post form data are untested.
export const POST_uriComponent_Attr = POSTAttr();
export const POST__blank_uriComponent_Attr = POSTAttr("_blank");
export const POST__parent_uriComponent_Attr = POSTAttr("_parent");
export const POST__top_uriComponent_Attr = POSTAttr("_top");

export const POST_formdata_Attr = POSTAttr("_self", "multipart/form-data");
export const POST__blank_formdata_Attr = POSTAttr("_blank", "multipart/form-data");
export const POST__parent_formdata_Attr = POSTAttr("_parent", "multipart/form-data");
export const POST__top_formdata_Attr = POSTAttr("_top", "multipart/form-data");