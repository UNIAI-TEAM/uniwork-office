/** Status bar text key after opening a deck: a one-slide deck gets the singular form. */
export function openedStatusKey(slideCount: number): 'appStatusOpened' | 'appStatusOpenedOne' {
  return slideCount === 1 ? 'appStatusOpenedOne' : 'appStatusOpened'
}
