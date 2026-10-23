// Returns the text below "## vX.Y.Z" in CHANGELOG.md up to the next version heading.
export function releaseNotes(changelog,version) {
 const lines=changelog.split(/\r?\n/),start=lines.findIndex(line=>line.startsWith('## ')&&line.slice(3).trim().split(/\s/)[0]===version);
 if(start<0)return '';
 const end=lines.findIndex((line,index)=>index>start&&line.startsWith('## '));
 return lines.slice(start+1,end<0?undefined:end).join('\n').trim();
}
