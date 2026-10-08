declare module "page-flip" {
  export class PageFlip {
    constructor(element: HTMLElement, settings: any);
    loadFromImages(images: string[]): void;
    loadFromHTML(elements: HTMLElement[]): void;
    flipNext(): void;
    flipPrev(): void;
    flip(page: number): void;
    getPageCount(): number;
    getCurrentPageIndex(): number;
    destroy(): void;
    on(event: string, handler: (e: { data: any }) => void): void;
    update(options: Partial<any>): void;
  }
}