/** Stop a click from waiting forever. The underlying work may still finish. */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  message = 'This is taking too long. Please try again.',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
