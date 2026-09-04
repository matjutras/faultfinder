// KiCanvas (vendored in public/kicanvas.js) registers <kicanvas-embed> as a
// custom element; it has no React bindings, so declare it as a JSX intrinsic.
declare namespace React.JSX {
  interface IntrinsicElements {
    'kicanvas-embed': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      controls?: 'none' | 'basic' | 'full';
    };
  }
}
