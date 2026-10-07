const fs = require('fs');
let code = fs.readFileSync('src/pages/Home.tsx', 'utf-8');

const regex = /\{song\.hasElrc \? \([\s\S]*?\) : null\}/;
const replacement = `<div className="absolute top-2 right-2 flex gap-1 z-10">
                      {song.hasLrc && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/20 text-[#FF4FA3] border border-[#FF4FA3]/30 backdrop-blur">
                          LRC
                        </span>
                      )}
                      {song.hasElrc && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30 backdrop-blur">
                          ELRC
                        </span>
                      )}
                    </div>`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/pages/Home.tsx', code);
