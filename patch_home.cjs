const fs = require('fs');
let code = fs.readFileSync('src/pages/Home.tsx', 'utf-8');

const regex = /\{song\.hasLrc && \(\s*<span className="absolute top-2 right-2 px-1\.5 py-0\.5 rounded text-\[9px\] font-bold uppercase tracking-wider bg-\[#FF4FA3\]\/20 text-\[#FF4FA3\] border border-\[#FF4FA3\]\/30 backdrop-blur z-10">\s*LRC\s*<\/span>\s*\)\}/g;
const replacement = `{song.hasElrc ? (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30 backdrop-blur z-10">
                        ELRC
                      </span>
                    ) : song.hasLrc ? (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/20 text-[#FF4FA3] border border-[#FF4FA3]/30 backdrop-blur z-10">
                        LRC
                      </span>
                    ) : null}`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/pages/Home.tsx', code);
