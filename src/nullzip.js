var trace = trace || function (o) { };
let crcTableEDB88320 = [];

/**
 * A non-compressing zip archive
 */
class NullZipArchive 
{
    /**
     * Creates a new non-compressing zip archive
     * @param {string} filename File names. Must be ASCII
     * @param {boolean=} createFolderEntries If true a zip entry is made for each folder (subfolders should work without this)
     */
	constructor(filename, createFolderEntries) {
		this.filename = filename;
		this.files = [];
		this.lastDownloadBlobUrl = null;
		this.createFolderEntries = !!createFolderEntries;
		this.buffer = null;

        // Zip stores timestamps in two ints: one for time and one for date
        var now = new Date();
		this.timeInt = Math.round(now.getSeconds() / 2) | (now.getMinutes() << 5) | (now.getHours() << 11);
		this.dateInt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	}

    /**
     * Add a text file to the archive, specifying the text
     * @param {string} filename File name, including directory path (e.g. subdir/text.txt)
     * @param {string} content File contents
     * @return {NullZipArchive} Returns itself for method chaining
     */
	addFileFromString(filename, content) {
		var binaryContent = (new TextEncoder('utf-8')).encode(content);
		this.addFileFromUint8Array(filename, binaryContent);
		return this;
	}

    /**
     * Add a file to the archive, using an array buffer as source data 
     * @param {string} filename File name, including directory path (e.g. subdir/text.txt)
     * @param {Uint8Array} binaryContent Array buffer
     * @return {NullZipArchive} Returns itself for method chaining
     */
	addFileFromUint8Array(filename, binaryContent) {
		if(!(binaryContent instanceof Uint8Array)) throw "invalid parameter";
		this.files.push({name:filename.replace('\\','/'), data:binaryContent});	
		return this;
	}

    /**
     * Generate a zip archive
     * @return {ArrayBuffer} Array buffer containing the zip archive
     */
	generate(){
		trace('NullZip archive generation started');
		var filesDict = {};
		for(let f of this.files) {
			f.size = f.data ? f.data.byteLength : 0;
			f.crc = f.data ? this.crc(f.data) : 0;
			filesDict[f.name]=f;
        }

		// Folders
		var result,created=[];
		if(this.createFolderEntries) { // apparently optional
			var regx = /\//gi;
			for(f of this.files){
				let filename = f.name;
				while((result=regx.exec(filename))){
					var f = {name:filename.substr(0,result.index+1),size:0,crc:0,data:new Uint8Array(0)};
					if(typeof filesDict[f.name] === "undefined") { 
						filesDict[f.name]=f;
						created.push(f);
					}
				}
			}
		}
		// Append folders to files array and sort it so folders always come before the files in them
		Array.prototype.push.apply(this.files, created);
		this.files.sort(function(a,b){return a.name.length - b.name.length || a.name.localeCompare(b.name);});		
		
		// Calculate file size 		
		// Each file takes 30+name+data and in CD 46+name, so 76+name.length*2+data per file, and 22 for footer
		var size = this.files.reduce(function(s,f) { return s + 76 + f.name.length * 2 + f.size; }, 22);		
		trace('Estimated file size: ' + size);
		
		this.buffer = new ArrayBuffer(size);
		var bw = new BinaryWriter(this.buffer);
		
		// Prepare file block header. We set same date/time on all (=now)
		var dirFileHeader = this.hex2u8a("504b0304140000000000");
		
		for(f of this.files) {
			f.offs = bw.i;					
			bw.writeByteArray(dirFileHeader);
			bw.uint16(this.timeInt);
			bw.uint16(this.dateInt);
			bw.uint32(f.crc);
			bw.uint32(f.size);
			bw.uint32(f.size);
			bw.uint16(f.name.length);
			bw.uint16(0); // extra-data length
			bw.writeASCII(f.name);
			if(f.size > 0){
				// Actual file! (gasp!)
				bw.writeByteArray(f.data);
			}
		}
		
		// Central Directory
		var cdStart = bw.i;
		var cdHeader = this.hex2u8a("504b01023f00140000000000");
		for(f of this.files) {
			bw.writeByteArray(cdHeader);
			bw.uint16(this.timeInt);
			bw.uint16(this.dateInt);
			bw.uint32(f.crc);
			bw.uint32(f.size);
			bw.uint32(f.size);
			bw.uint16(f.name.length);
			bw.uint16(0); // extr
			bw.uint16(0); // comment
			bw.uint16(0); // disk#
			bw.uint16(0); // int.attr.
			bw.uint32(f.size ? 32 : 48); // extra attr.
			bw.uint32(f.offs);
			bw.writeASCII(f.name);	
		}
		var cdSize = bw.i - cdStart;
		
		// End block
		bw.writeByteArray(this.hex2u8a("504b050600000000"));
		bw.uint16(this.files.length);
		bw.uint16(this.files.length);
		bw.uint32(cdSize);
		bw.uint32(cdStart);
		bw.uint16(0); // Comment length
		
		trace('Finished creating zip. size='+bw.i+', predicted size='+size);
		
		return this.buffer;
	}

    /**
     * Creates an ObjectURL blob containing the generated xlsx
     * @return {string} ObjectURL to xlsx
     */
	createDownloadUrl() {
		if(!this.buffer) this.generate();
		var downloadBlob = new Blob([this.buffer], { type: 'application/zip' });
		if (this.lastDownloadBlobUrl) window.URL.revokeObjectURL(this.lastDownloadBlobUrl);
		this.lastDownloadBlobUrl = URL.createObjectURL(downloadBlob);
		return this.lastDownloadBlobUrl;
    }

    /**
     * Create download link object (or update existing)
     * @param {(string|HTMLAnchorElement)} linkText Existing link object or text to set on new link
     * @return {!Element} Link object
     */
	createDownloadLink(linkText) {
		var link = linkText instanceof HTMLAnchorElement ? linkText : document.createElement('a');
		if(typeof linkText === "string") link.innerHTML = linkText;	  
		link.href = this.createDownloadUrl();
		link.download = this.filename;
		if(!link.hasChildNodes) link.innerText = this.filename;
		trace('Link created for file ' + this.filename);
		return link;
	}

    /**
     * Calculates CRC
     * @param {Uint8Array} u8arr Array buffer with data
     * @return {number} CRC
     */
	crc(u8arr) {
		var c,n,z=0^(-1);
		if(!crcTableEDB88320) { // Cache CRC table 
			crcTableEDB88320 = [];
			for(n = 0; n < 256; c = ++n) {
				for(var k =0; k < 8; k++)
					c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));			
				crcTableEDB88320[n] = c;
			}
		}
		for(var i = 0; i < u8arr.byteLength; i++)
			z = (z >>> 8) ^ crcTableEDB88320[(z ^ u8arr[i]) & 0xFF];
		return (z ^ -1) >>> 0;
	}

    /**
     * Parse hexadecimal string into an array buffer
     * @param {string} string Hexadecimal string
     * @return {Uint8Array} Array buffer with converted data
     */
	hex2u8a(string){	
		var bytes = new Uint8Array(Math.ceil(string.length / 2));
		for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(string.substr(i * 2, 2), 16);
		return bytes;
	}
}

/**
 * Helper to write stuff to an ArrayBuffer
 */
class BinaryWriter {
    /**
     * Create helper to write to an array buffer
     * @param {ArrayBuffer} buffer Array buffer to write to
     */
    constructor(buffer) {
        this.dw = new DataView(buffer);
        this.i = 0;
        this.le = true;
        this.utf8encoder = new TextEncoder('utf-8');
    }

    /**
     * Write unsigned 8-bit integer
     * @param {number} v Number to write
     */
    uint8(v) {
        this.dw.setUint8(this.i++, v);
    }

    /** 
     * Write unsigned 16-bit integer
     * @param {number} v Number to write
     */
    uint16(v) {
        this.dw.setUint16(this.i, v, this.le);
        this.i += 2;
    }

    /** 
     * Write unsigned 32-bit integer
     * @param {number} v Number to write
     */
    uint32(v) {
        this.dw.setUint32(this.i, v, this.le);
        this.i += 4;
    }

    /** 
     * Add array buffer
     * @param {Uint8Array} byteArray Data to write
     */
    writeByteArray(byteArray) {
        if (!(byteArray instanceof Uint8Array)) throw 'invalid parameter';
        new Uint8Array(this.dw.buffer).set(byteArray, this.i);
        this.i += byteArray.byteLength;
    }

    /** 
     * Add string
     * @param {string} string String to write
     */
    writeASCII(string) {
        for (var i = 0; i < string.length; i++)
            this.dw.setUint8(this.i++, string.charCodeAt(i) & 0xFF);
    }
}