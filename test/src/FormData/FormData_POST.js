async function postFetch(url, formData) {
  const res = await fetch(url, {method: "POST", body: formData});
  if (res.status >= 200 && res.status < 300)
    return res;
  //todo here it is possible to manage res.status 3xx. For example.
  throw `Failed to fetch "${url.href}": ${res.status} ${res.statusText}.`
}

function formDataEntryToInputElement([name, value]) {
  return (value instanceof String || typeof value === "string") ? stringInput(name, value) : fileInput(name, value);
}

function fileInput(name, blob) {
  const container = new DataTransfer();                                     // WIP: UTF8 character error
  const file = new File([blob], blob.fileName, {type: blob.type, lastModified: blob.lastModified}, 'utf-8');
  container.items.add(file);
  const input = document.createElement("input");
  input.type = "file";
  input.files = container.files;
  return input;
}

function stringInput(name, value) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}

function openForm(href, target, formData) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = href;
  form.target = target;
  form.enctype = "multipart/form-data";
  form.style.display = "none";
  form.appendChild(...formData.entries().map(formDataEntryToInputElement));
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function dispatchAsyncErrorEvent(target, error) {
  const e = new ErrorEvent("error", {bubbles: true, composed: true, error});
  e.defaultAction = _ => console.error(error);
  target.dispatchEvent(e);
}

export function FormData_POST(returnType) {
  return class FormData_POST extends Attr {
    upgrade() {                                       //todo move to under onChange
      this._eventType = this.name.match(/[^:-]+/)[0];
    }

    async onEvent({detail: formData}) {
      try {
        const detail = await (await postFetch(this.value, formData))[returnType]();
        this.ownerElement.dispatchEvent(new CustomEvent(this._eventType, {bubbles: true, composed: true, detail}));
      } catch (err) {
        const target = this.ownerElement.isConnected ? this.ownerElement : window;
        dispatchAsyncErrorEvent(target, `${this.name}: ${err}`);
      }
    }
  }
}

export function FormData_POST_open(target = "_self") {
  return class FormData_POST_open extends Attr {
    onEvent({detail: formData}) {
      openForm(this.value, target, formData);
    }
  }
}