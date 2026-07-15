type EventHandler = (event: Event) => unknown;

export function once(fn?: EventHandler) {
  let handler = fn;

  return function (event: Event) {
    if (handler) handler(event);
    handler = undefined;
  };
}

export function preventDefault(fn?: EventHandler) {
  return function (event: Event) {
    event.preventDefault();

    if (!fn) return;

    fn(event);
  };
}

export function stopPropagation(fn?: EventHandler) {
  return function (event: Event) {
    event.stopPropagation();

    if (!fn) return;

    fn(event);
  };
}
