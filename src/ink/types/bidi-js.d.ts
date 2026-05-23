declare module 'bidi-js' {
  type BidiFactory = () => {
    getEmbeddingLevels(
      text: string,
      direction: 'auto' | 'ltr' | 'rtl'
    ): {
      levels: number[];
      paragraphs: Array<{ start: number; end: number; direction: 'ltr' | 'rtl' }>;
    };
  };
  const bidiFactory: BidiFactory;
  export default bidiFactory;
}
