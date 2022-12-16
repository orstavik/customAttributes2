# Pattern: FetchReaction

The most important reaction on the modern web is to fetch a network resource upon an event: FetchReactions. The FetchReaction will be triggered by an event, receive some data, use that data to dispatch a network request to a server (a `fetch`-call), and then deliver the output back to the web application that will put the response in an event or use the data to update its content.


## WhereTo: set the boundaries?

There are *many* ways to do `fetch` calls. And they vary based on two points: server input format and server output format.
1. what is the server input format? Does the server expect a simple path to a static resource (eg. `/path/to/file.html`), a text with json data to be stored on the server, or a `FormData` object?
2. what is the server output format? Does the response object contain `.json()`? or `.text()`? or a binary stream?

When making FetchReactions, you should both make the fetch request and process the response in a single reaction. But why? We could perfectly well *split* the FetchReaction in two, one reaction for turning the input into a fetch request and another reaction for processing the network output. But we don't. We shouldn't. Because the server is the common denominator. It is the same server that specifies the input and output formats. And they are co-dependent, thus binding the fetch request and fetch response reactions on the client side. And so, it makes more sense treating the FetchReaction as one (less room for errors, easier to read and understand), than it is to separate them into two separate, but still co-dependent and bound to each other reactions.

## HowTo: manage request and response settings?

A FetchReaction involves multiple settings. We have:
1. the url to the external resource,
2. request settings,
3. request body, and
4. response processing settings.

The simple rules of thumb are:
1. the request body is the reaction input (`e`).
2. the url is either the customAttribute `value`, or the first customReaction postFix when the resource is on the same server as the owner `document`.
3. Other request and response settings are most likely static. They are determined by the particular server, and they should be hardcoded into the FetchReaction.
4. If you have some other request and response settings that are dynamic, then you should try to create a custom request body input format. For example, you might vary the `path` aspect of the request as well as a `FormData` request body. In such cases, you need to either add the `path` to the `FormData` input and then extract that path from the `FormData` when preparing the `fetch` request.
5. If you are making/using generic FetchRequest functions, you might open up for some additional static request and response settings as customReaction arguments.

> Note: try to avoid 4. and 5. above. It is often better to have several FetchReactions behaving in one way each, than having one FetchReaction that you can alter into behaving in several ways. Safer. Faster. Easier to manage.  

 ## Anti-pattern: `<form action method enctype>`

There are two other places where we could specify the arguments for our FetchReaction:  
1. other attribute values on the customAttribute's `.hostElement`, and/or
2. the `innerText` or attribute value on the `.hostElement`'s children or descendant elements.

We are of course thinking about `<form>`s. 

```html
<form action="path" method="post" enctype="multipart/formdata">
  <input type="text" name="one" value="hello">
  <textarea name="two">sunshine</textarea>
</form>
```

First, the `action` attribute is a native attribute that contains the FetchReaction. This `action` attribute has two "setting attributes" `method` and `enctype` connected to the same `hostElement`. This is not a good strategy. The `method` and `enctype` properties should either be hard coded in the FetchReaction function, or added as customReaction arguments.

Second, the task of harvesting the name+value data should be specified in a DomReaderReaction (see later chapter). There might be different ways to generate a correct request body, depending on the DOM context, and this action should not be lumped in with the fetch request and response management of the FetchReaction.  

## Demo 1: GET-file

Get a static text resource such as a .json, .html, or .txt file from a fixed location. The path of the file is not dynamic. 

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<div click:fetch_json:updatechild="https://httpbin.org/uuid">click me to generate uuids: <span>...</span></div>
<script type="module">
   customReactions.define("updatechild", function (e) {
      this.ownerElement.firstElementChild.innerText = e.uuid;
      return e;
   });
   customReactions.define("fetch", async function (e, _, returnType) {
      return await (await fetch(this.value))[returnType]();
   });
</script>
```

The trigger event on the `<div>` element is `click:`. Every time a `click` is registered on the `<div>`, then the `:fetch_json` reaction runs. This reaction gets the static resource from the customAttribute value which is a fixed `"https://httpbin.org/uuid"`. This resource is then unwrapped as a json object. This json with a `uuid` is then passed to `:updatechild` reaction, which takes the `.uuid` property and puts in the `.innerText` value of the `.firstElementChild` of the `<div>`.  

We could say that this `fetch` is the default FetchReaction. But. That would be misleading. This `fetch` is the "default" when:
1. the fetch request only needs a path to complete the request (ie. a `GET` request), and
2. that path is fixed (ie. there are no varying query paramenters such as `?one=hello&two=sunshine`).

As soon as the query needs to add 1) a request body (ie. make a `POST` request), or 2) alter the content of the request based on DOM or event context (ie. add/modify query parameters), then a different fetch structure is needed. 

## Demo 2: open sesame

What makes the web magic is the hypertext dimension. The link. The `<a href>`. Translated to customReactions and javascript, the `<a href>` is merely a FetchReaction to a UI click that instead of retrieving data in the background, closes the current web application and `open`s the new web application in the same tab/window.    

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<a href="https://example.com">link to example.com</a>

<u click:open="https://httpbin.org">link to httpbin.org</u>

<script type="module">
   customReactions.define("open", function (e, _, target = "self") {
      window.open(this.value, "_" + target);
   });
</script>
```

## Demo 3: a void fetch

When making a single page application, you want the user to navigate between pages on the same server *without reloading the page*. This is essentially a void fetch: a) change the location of the current application window, but b) make no network request. In the example below we call this FetchReaction `:goto`.  

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<u click:goto="page2">link to page2 inside SPA</u>

<script type="module">
   customReactions.define("goto", function (_) {
      history.pushState(null, null, this.value);
      window.dispatchEvent(new PopStateEvent("popstate")); 
   });
</script>
```

Whenever the user changes the location address within the same page by navigating forward/backward within the page, then the popstate event is dispatched. It is therefore recommended to dispatch a `popstate` event immediately after calling `history.pushState`. Then, the reaction to all non-loading-changes of the browser's location can be unified as reactions to the `popstate` event.

## Demo 4: post data

The `POST` FetchReaction uses a dynamic request as input, and then passes this body to the server. The request body is obtained by *reading the DOM* (more on that in the next chapter about the ReadDOM pattern). The demo then puts the result in a box beneath

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<form dblclick:formdata:post:updatesibling="https://httpbin.org/anything">
  <h3>dblclick and see the response below.</h3>
  hello: <input type="text" name="hello" value="sunshine">
</form>
<pre>...</pre>

<script type="module">
  customReactions.define("formdata", function (e) {
    return new FormData(this.ownerElement);
  });
  customReactions.define("post", async function (body) {
    const response = await fetch(this.value, {
      method: "POST",
      enctype: "multipart/formdata",
      body
    });
    return await response.json();
  });
  customReactions.define("updatesibling", function (json) {
    this.ownerElement.nextElementSibling.innerText = JSON.stringify(json, null, 2);
    return json;
  });
</script>
```

## HowTo: pass in the URL?

Unless a custom format for processing customAttribute values is implemented and shared by all the necessary customAttribute and customReaction definitions, the value of the customAttribute can only be used by a single definition per customAttribute. Put simply, only a single customReaction definition or the customAttribute definition should use `this.value` per customAttribute instance. And therefore, when possible, both customAttributes and customReactions should avoid relying on `this.value` for passing in settings/store state. 

Still, in the above examples, the URL is passed in using the `this.value` of the customAttribute. And this is considered ok. By convention, the FetchReaction use the attribute value to specify the url (cf. `<a href="https://example.com>`), and so seeing the url here can make it easier to recognize the FetchReaction as such and the html template easier to read.

But. If we can, we still want to avoid having FetchReactions use `this.value`. And for many of the common FetchReactions, this is actually convenient. Many web apps communicate towards the same origin when making POST and GET request. The endpoints are often only a single word: `/update`, `/load` etc. The name of these endpoints can therefore easily be added as postfix arguments to the customAttribute, such as `:db_update` and `:db_load`.