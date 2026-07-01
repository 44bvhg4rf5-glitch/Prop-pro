// HM Land Registry CCOD — "UK companies that own property" — filtered to HA.
// Company/LLP landlords WITH the company's own correspondence address (the key
// to posting to the landlord, not the tenant).
// Shape: { a: propertyAddress, p: postcode, company: legalOwnerName,
//          corr: companyCorrespondenceAddress, cro?: companyRegNo, tenure?: 'F'|'L' }
// Free but ACCOUNT-GATED: download the CCOD CSV from HMLR's "Use land and
// property data" portal (free sign-up), then run scripts/build-ccod-ha.mjs to
// filter it to HA postcodes and write this module. Empty until then; the
// landlord layer merges it in automatically once populated.
export const CCOD_HA = [];
