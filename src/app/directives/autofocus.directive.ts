import { AfterContentInit, Directive, ElementRef, Input } from '@angular/core';

@Directive({
  selector: '[autoFocus]'
})
export class AutofocusDirective implements AfterContentInit {

  @Input() public appAutoFocus: boolean;

  constructor(private el: ElementRef) {
    console.log('AutofocusDirective EL constructor', this.el)
    if (!el.nativeElement['focus']) {
      throw new Error('Element does not accept focus.');
    }
  }

  ngAfterContentInit() {
    console.log('AutofocusDirective appAutoFocus', this.appAutoFocus)
    const input: HTMLInputElement = this.el.nativeElement as HTMLInputElement
    
    // input.select();
    setTimeout(() => {
      input.focus();
    //   this.el.nativeElement.focus();
    //   console.log('AutofocusDirective EL ngAfterContentInit', this.el)
    }, 500);

  }
}
