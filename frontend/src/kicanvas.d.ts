// KiCanvas (vendored in public/kicanvas.js) registers <kicanvas-embed> as a
// custom element; it has no React bindings, so declare it as a JSX intrinsic.
declare namespace React.JSX {
  interface IntrinsicElements {
    'kicanvas-embed': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      controls?: 'none' | 'basic' | 'full';
      // No `theme` attribute here: <kicanvas-embed> declares one, but this
      // vendored build never reads it (confirmed: zero references to
      // `this.theme` in its own class body). The theme is actually chosen
      // through the global preferences localStorage key -- see index.html.
    };
  }
}
