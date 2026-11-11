/** Source-code / archive formats accepted by NEXBOTS. All files remain opaque
 * downloads (octet-stream + attachment); none are served as executable pages.
 */
export const PROJECT_FILE_EXTENSIONS=Object.freeze(new Set([
 'zip','tar','gz','tgz','bz2','xz','7z','rar',
 'js','mjs','cjs','jsx','ts','tsx','py','php','json','txt','md',
 'html','htm','css','scss','sass','less','vue','svelte','java',
 'kt','kts','swift','go','rs','rb','c','cc','cpp','h','hpp','cs',
 'lua','dart','sql','graphql','gql','yaml','yml','xml','toml',
 'ini','cfg','conf','sh','bash','ps1','bat','ipynb','r','pl'
]));
export function isSupportedProjectFile(name) {
 if(typeof name!=='string'||name.length>120||name.length<3||name.includes('/')||name.includes('\\')||/\p{Cc}/u.test(name))return false;
 const ext=name.toLowerCase().split('.').pop();
 return PROJECT_FILE_EXTENSIONS.has(ext);
}
