async function getFetch(url) {
    const res = await fetch(url, {method: "GET"});
    if (res.status >= 200 && res.status < 300)
        return res;
    //todo here it is possible to manage res.status 3xx. For example.
    throw `Failed to fetch "${url.href}": ${res.status} ${res.statusText}.`
}

function dispatchAsyncErrorEvent(target, error) {
    const e = new ErrorEvent("error", {bubbles: true, composed: true, error});
    e.defaultAction = _ => console.error(error);
    target.dispatchEvent(e);
}

function formDataToEncodedUri(href, formData) {
    const url = new URL(href);
    if (!formData)
        return url;
    for (let [k, v] of formData.entries()) {
        if (!(v instanceof String) && typeof v !== "string")
            throw TypeError("FormData with File/Blob entities cannot be encoded to uriComponent.");
        url.searchParams.set(k, v);
    }
    return url;
}

//this should probably be a load_json
export async function FormData_GET(e, [returnType = "json"], eventType) {
    let formData = e.formData; //todo: clarify this? e.detail can has some value
    const url = formDataToEncodedUri(this.value, formData);
    try {
        const detail = await (await getFetch(url))[returnType]();
        customEvents.dispatch(new CustomEvent(eventType, {detail}), this.ownerElement);
    } catch (err) {
        const target = this.ownerElement.isConnected ? this.ownerElement : window;
        dispatchAsyncErrorEvent(target, `${this.name}: ${err}`);
    }
}

export class FormData_History extends Attr {
    async onEvent({detail: formData}) {
        const url = formDataToEncodedUri(this.value, formData);
        history.pushState(null, null, url.href);
        window.dispatchEvent(new PopStateEvent("popstate"));
    }
}

function FormData_open_GET(e, target) {
    const formData = e.detail;
    const url = formDataToEncodedUri(this.value, formData);
    window.open(url, target);
}

export const FormData_open_GET_self = function (e) {
    FormData_open_GET.call(this, e, "_self");
}

export const FormData_open_GET_blank = function (e) {
    FormData_open_GET.call(this, e, "_blank");
}

export const FormData_open_GET_parent = function (e) {
    FormData_open_GET.call(this, e, "_parent");
}

export const FormData_open_GET_top = function (e) {
    FormData_open_GET.call(this, e, "_top");
}