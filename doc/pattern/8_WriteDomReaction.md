# Pattern: WriteDomReaction

WriteDomReactions updates a branch of the DOM according to a new state. The reaction receives a piece of data, e.g. a json object, and then updates the DOM to reflect this data.

In principle WriteDomReactions translate a DOM-external state into DOM-internal state. Often, the DOM-external state is a JS/JSON object, but it doesn't have to be. A server can for example pass a string with a different format, even a string with ready-made HTML.

## Demo 1: DIY JSON to HTML

The first WriteDomReaction is a hand-sewn JSON to HTML function. It takes a json object with **a known structure** and then integrates the JSON data into a new structure.

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<div class="container" click:get-random-data:render>
  <div class="card">
    <h3 style="color:red">hello</h3>
    <div>sunshine</div>
  </div>
</div>

<script>
  customReactions.define("get-random-data", _ => [
    {title: "hello", text: "sunshine", color: "red"},
    {title: "goodbye", text: "darkness", color: "blue"},
    {title: "hello", text: "happiness", color: "gold"}
  ][Math.floor(Math.random()*3]));
  customReactions.define("render", function({title, text, color}){
    this.ownerElement.innerHTML = `<div class="card">
    <h3 style="color:${color}">${title}</h3>
    <div>${text}</div>
  </div>`;
  });
</script>
```

## Demo 2: HandlbarsReaction

The JS/HTML echo system has a myriad of libraries for automating JSON=>DOM. And some of these libraries, such as Handlebars, are compatible with customAttributes. So, instead of developing your own DIY JSON=>DOM transformer, we recommend integrating an existing HTML template engine.

```html
<script src="https://cdn.jsdelivr.net/combine/gh/orstavik/customAttributes2/src/customAttributes.js,gh/orstavik/ElementObserver@1.1.0/startObserver.js"></script>

<div class="container" click:get-random-data:render>
  <div class="card">
    <h3 style="color:{{color}}">{{title}}</h3>
    <div>{{text}}</div>
  </div>
</div>

<script  src="https://cdn.jsdelivr.net/npm/handlebars@4.7.7/dist/handlebars.js"></script>
<script>
  customReactions.define("get-random-data", _ => [
    {title: "hello", text: "sunshine", color: "red"},
    {title: "goodbye", text: "darkness", color: "blue"},
    {title: "hello", text: "happiness", color: "gold"}
  ][Math.floor(Math.random()*3)]);

  let template;
  customReactions.define("render", function(json){
    template ??= Handlebars.compile(this.ownerElement.innerHTML);
    this.ownerElement.innerHTML = template(json);
    return json;
  });
</script>
```

## Why: mutate(!), and not just rewrite?

The core problems of the WriteDomReactions are the same of that of most HTML template engines such as Handlebars, uHTML, litHTML, etc. How can we update the DOM elements:
1. efficiently and
2. preserve JS consistency.

Efficiency is simple. Efficiency can be improved if we avoid updating elements that hasn't changed and avoid updating a full element if only a few of its properties has changed.

JS consistency is a big and important problem. Whenever we create a new HTML element in place of an old one, we replace the JS object representation of the old element with a brand new JS object. Swapping identically looking JS objects is a source of many headaches. First, references to the old JS object might be used by other closures and objects in the app, elsewhere. Second, the old JS object might have added JS only properties such as event listeners or added/mutated JS properties. Both of these old JS only references are completely wiped out, likely causing major bugs and/or performance issues if not handled explicitly.

To narrow the problem slightly, we can say that if the HTML elements whose state is being updated *only*:
1. contain state visible in the DOM (ie. no event listeners and no hidden JS object properties) *and*
2. is not used in any JS `Map`/`Set`s elsewhere in the app, then
* the only drawback of *overwriting* the HTML template is efficiency.

However, if the HTML branch being updated contains either 1) or 2) above, then the HTML branch **should be mutated**(!), and not simply overwritten. Now, how to mutate/update "correctly" is an art, something that might need a complete custom algorithm, and territory that HTML template engines (should) compete fiercely to dominate. So, nuances here is handled elsewhere.

## ProblemsWith: compilation-based HTML template engines

Compilation based template engines is in my personal view... not good. Adding the dependency on compilation often result in quite idiosynchratic design-time and run-time environments that in complexity rivals the complexity of the browser environment. Both in terms of grammatical and semantic bindings. It makes some operations easier at the expense of making the whole system vastly more complex. So. Even though it is theoretically possible, this project does not attempt to bridge any gaps to compilation based libraries. This project is straight in the browser only, notepad and codepen accessible.

## ProblemsWith: string-literal-based HTML template engines

String-literal based template engines such as uHTML and litHTML pose a different problem: they are one-way JS to HTML. This means that when the developer writes the HTML document, he cannot in the HTML code formulate the template and style it directly in your HTML code. Instead, he must make a JS function with JSON dummy object, run the JS function with the JSON code to create a piece of DOM dynamically, and then view and style your dynamic only branch of HTML.

"Dynamic only DOM branches" is not only a practical nuisance. It brakes an HTML principle. HTML is a representation of the app. At a particular state. When you make an HTML document, the HTML document is a representation of what the app looks like when it starts. This start representation should be... representative. If the start HTML document is just a skeleton, then the HTML at design time doesn't really represent the app, only parts of the app.

When the HTML document misses some elements (that are only dynamically generated), your HTML document is also having holes in its:

1. css anchor points (the css template reference elements, classes, structures that you cannot see in the HTML document),
2. event paths (the html document doesn't show the event paths, so you must imagine where events will travel),
3. origin anchors for events (events will likely arise from points that are not visible in the HTML document), and
4. reaction anchors for events (reactions to events will be applied and arise from elements not visible in HTML).