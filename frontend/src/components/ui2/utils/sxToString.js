export const camelToKebab = (str) => {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
};
export function sxToString(sx) {
    if (!sx)
        return "";
    return Object.entries(sx).map(([key, value]) => `${camelToKebab(key)}: ${value}`).join("; ");
}
// export const sxToStringReduce = (sx: object) => {
//   return Object.entries(sx).reduce((acc, [key, value]) => {
//     return `${acc}${key}:${value};`;
//   }, "");
// };
//# sourceMappingURL=sxToString.js.map