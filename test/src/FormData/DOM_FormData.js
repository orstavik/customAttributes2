//The [name] convention.
// get all non-empty [name] descendants, but only one level deep in the [name] hierarchy.
function getNames(scope) {
  return scope.querySelectorAll(':scope > [name]:not([name=""]),:scope :not([name]) [name]:not([name=""])');
}

//todo update getValue for files, it doesn't really work..
//     if the entity is a <img src> or <input type=file>, then we need to make the value a Blob.

//The [.value] convention.
// 1. HTML 1: direct attribute on element wins, first [value], then [src].
// 2. HTML 2: [name]children list.
//             If the element has [name] (no [value] nor [src]), and then lots of children with [name] attributes,
//             then the value is a `;` separated lists of the [name] value of its children.
// 3. JS: if the .value property has been declared on the element, we use that.
// 4. Fallback solution: outerHTML.

function getValue(el) {
  if (el.hasAttribute("value")) return el.getAttribute("value");
  if (el.hasAttribute("src")) return el.getAttribute("src");
  const childrenName = el.querySelectorAll(':scope > [name]:not([name=""])');
  if (childrenName.length)
    return [...childrenName].map(el => el.getAttribute("name")).join(";");
  if ("value" in el)
    return el.value;
  return el.outerHTML;
}

export function DOM_FormData_Lazy() {
  const target = this.ownerElement;
  if(target.tagName === "FORM")
    return new FormData(target);
  return  {
    get detail() {
      const namedDesc = getNames(target);
      if (!namedDesc.length)
        return null;
      const formData = new FormData();
      for (let el of namedDesc)
        formData.append(el.getAttribute("name"), getValue(el));
      return formData;
    }
  };
}

export function DOM_FormData() {
  if(this.ownerElement instanceof HTMLFormElement)
    return new FormData(this.ownerElement);
  const namedDesc = getNames(this.ownerElement);
  if (!namedDesc.length)
    return null;
  const formData = new FormData();
  for (let el of namedDesc)
    formData.append(el.getAttribute("name"), getValue(el));
  return formData;
}