declare module 'node-id3' {
  export interface Tags {
    title?: string;
    artist?: string;
    album?: string;
    trackNumber?: string;
    partOfSet?: string;
    year?: string;
    genre?: string;
    image?: {
      mime: string;
      type: {
        id: number;
        name?: string;
      };
      description?: string;
      imageBuffer: Buffer;
    };
    [key: string]: any;
  }

  export function write(tags: Tags, fileBufferOrPath: string | Buffer): boolean | Buffer;
  export function update(tags: Tags, fileBufferOrPath: string | Buffer): boolean | Buffer;
  export function read(fileBufferOrPath: string | Buffer): Tags;
  
  const NodeID3: {
    write: typeof write;
    update: typeof update;
    read: typeof read;
  };

  export default NodeID3;
}
