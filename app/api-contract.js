(function (root) {
  const protocol = 1;
  const required = ["role-identity", "facilitator-accounts", "training-sessions", "training-decisions", "csat", "csat-sharing"];
  function compatible(value) {
    return !!value && value.ok === true && Number.isInteger(value.protocol) && value.protocol >= protocol &&
      Array.isArray(value.capabilities) && required.every(feature => value.capabilities.includes(feature));
  }
  const contract = { protocol, required, compatible };
  if (typeof module === "object" && module.exports) module.exports = contract;
  else root.BookingApiContract = contract;
})(typeof window === "object" ? window : globalThis);
