// Harrow Council HMO + selective-licence register (HA1/2/3).
// Same shape as the Brent register (lib/data/hmo-ha.js):
//   { a: propertyAddress, p: postcode, t: licenceType, h: licenceHolder, c?: holderCorrespondenceAddress }
// Harrow publishes this as a SEARCH-ONLY public register (no file/API), and is
// rolling out six new selective schemes across 2026, so the named-landlord list
// grows through the year. Populate this via scripts/build-harrow-licences.mjs
// (from an FOI export or a register scrape) — the moment it has rows, every
// landlord tool below picks them up automatically.
export const HARROW_LICENCES = [];
