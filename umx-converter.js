window.UMXConverter = function() {
	const converter = this;

	this.options = {
		format        : "umx",
		bitDepth      : 16,
		sampleRate    : 22050,
		stereo        : true,
		extraChannels : 2,
		name          : "output",
		success       : null, // optional
		error         : null, // optional
	}

	this.convert = function(options) {
		// Merge options
		converter.options = {...converter.options, ...options};

		// UT object names are fairly easy to break, so remove non-word characters and trim to 254 bytes (the max name length)
		converter.options.name = converter.options.name.replace(/\W/g, "").substring(0, 0xFF - 1);

		if (converter.options.input === undefined) {
			throw "Missing input data";
		}

		const format = converter.options.format.toLowerCase();

		switch (format) {
			case "it":
			case "umx":
				const audioContext = new AudioContext({
					sampleRate: converter.options.sampleRate
				})

				audioContext.decodeAudioData(converter.options.input, function(inputAudio) {
					const wavData = converter.audioBufferToWav(inputAudio);

					const it = converter.wavToImpulse(wavData, inputAudio);

					if (format === "it") {
						converter.save(it, `${converter.options.name}.it`);
					} else {
						const umx = converter.impulseToUMX(it);
						converter.save(umx, `${converter.options.name}.umx`);
					}

					if (typeof converter.options.success === "function") {
						converter.options.success();
					}

				}, function(error) {
					converter.showError(error);
				})
			break;

			default:
				converter.showError(`Unknown output format specified: ${converter.options.format}`);
			break;
		}
	}

	/**
	 * Create a data blob then prompt a file download
	 */
	this.save = function(data, filename, type = "application/octet-stream") {
		const blob = new Blob([data], {
			type: type
		})

		const url = window.URL.createObjectURL(blob);

		const a = document.createElement("a");

		a.href     = url;
		a.download = filename;

		a.click();

		window.URL.revokeObjectURL(url);
	}

	/**
	 * Passes an error to a callback if provided, otherwise thrown
	 */
	this.showError = function(error) {
		if (typeof converter.options.error === "function") {
			converter.options.error(error);
		} else {
			throw error;
		}
	}

	/**
	 * Creates an .IT file following the format spec at github.com/schismtracker/schismtracker/wiki/ITTECH.TXT
	 * Some of the values below are copied from various test .IT files exported from OpenMPT
	 */
	this.wavToImpulse = function(wavData, inputAudio) {
		const OrdNum = 2;
		const InsNum = 0;
		const SmpNum = wavData.length;
		const PatNum = 1;

		// Round up duration and add a row to allow space
		const totalRows = Math.ceil(inputAudio.duration) + 1;

		// Calculate output file size
		// Initial part of header is always 0xC0 / 192 bytes
		const headerSize  = 0xC0 + OrdNum + (InsNum * 4) + (SmpNum * 4) + (PatNum * 4);
		const sampleSize  = 0x50 * SmpNum;
		const patternSize = 8 + (SmpNum * 4) + (SmpNum * converter.options.extraChannels * 4) + totalRows + (wavData.reduce((size, channel) => size + channel.byteLength - 44, 0));

		// Output buffer/data view
		const buffer = new ArrayBuffer(headerSize + sampleSize + patternSize);
		const data   = new DataView(buffer);

		let offset = 0;

		// Magic number
		converter.writeString(data, offset, "IMPM");
		offset += 4;

		// Skip song name
		offset += 26;

		// PHiligt - pattern row hilight information
		data.setUint16(offset, 0x0410);
		offset += 2;

		// OrdNum - number of orders in song
		data.setUint16(offset, OrdNum, true);
		offset += 2;

		// InsNum - number of instruments in song
		data.setUint16(offset, InsNum, true);
		offset += 2;

		// SmpNum - number of samples in song
		data.setUint16(offset, SmpNum, true);
		offset += 2;

		// PatNum - number of patterns in song
		data.setUint16(offset, PatNum, true);
		offset += 2;

		// Cwt/v - created with tracker
		data.setUint16(offset, 0x2951);
		offset += 2;

		// Cmwt - compatible with tracker with version greater than value
		data.setUint16(offset, 0x1402);
		offset += 2;

		// Flags (set to default from OpenMPT)
		data.setUint16(offset, 0x4900);
		offset += 2;

		// Special
		data.setUint16(offset, 0x0600);
		offset += 2;

		// GV - global volume
		data.setUint8(offset, 0x80);
		offset++;

		// MV - mix volume
		data.setUint8(offset, 0x30);
		offset++;

		// IS - initial speed of song
		// From OpenMPT docs: "In OpenMPT, 'Speed' means 'ticks per row'"
		// Set to 24 as "classic tempo" units are 24 ticks per minute
		data.setUint8(offset, 24);
		offset++;

		// IT - initial tempo of song
		// Set to 60 BPM to easily synchronise with input audio
		data.setUint8(offset, 0x3C);
		offset++;

		// Sep - panning separation between channels
		data.setUint8(offset, 0x80);
		offset++;

		// PWD - pitch wheel depth for MIDI controllers
		data.setUint8(offset, 0x00);
		offset++;

		// MsgLgth / message offset / reserved
		offset += 10;

		// Channel pan - if stereo, pan L/R
		// 0  = hard left
		// 32 = centre
		// 64 = hard right
		if (wavData.length === 2) { // stereo
			data.setUint8(offset, 0x00);
			offset++;

			for (let i = 0; i < converter.options.extraChannels; i++) {
				data.setUint8(offset, 0x00);
				offset++;
			}

			data.setUint8(offset, 0x40);
			offset++;

			for (let i = 0; i < converter.options.extraChannels; i++) {
				data.setUint8(offset, 0x40);
				offset++;
			}
		} else { // mono
			data.setUint8(offset, 0x20);
			offset++;

			for (let i = 0; i < converter.options.extraChannels; i++) {
				data.setUint8(offset, 0x20);
				offset++;
			}
		}

		for (let i = 0; i < 64 - wavData.length - (converter.options.extraChannels * wavData.length); i++) {
			data.setUint8(offset, 0xA0);
			offset++;
		}

		// Channel vol
		for (let i = 0; i < 64; i++) {
			data.setUint8(offset, 0x40);
			offset++;
		}

		// Orders - order in which the patterns are played
		data.setUint8(offset, 0x00);     // pattern 0
		data.setUint8(offset + 1, 0xFF); // "---", end of song marker
		offset += 2;

		// Instruments offset
		// 0 instruments, so do nothing here

		// Samples offset
		// 0x50 = Impulse Sample header size
		for (let i = 0; i < SmpNum; i++) {
			data.setUint32(offset, headerSize + (i * 0x50), true);
			offset += 4;
		}

		// Patterns offset
		data.setUint32(offset, headerSize + (SmpNum * 0x50), true);
		offset += 4;

		/**
		 * Impulse Sample
		 */
		for (let i = 0; i < SmpNum; i++) {
			converter.writeString(data, offset, "IMPS");
			offset += 4;

			// DOS filename
			offset += 12;

			// Always null
			offset++;

			// GvL - global volume for instrument
			data.setUint8(offset, 0x40);
			offset++;

			// Flg - bit 1 on = 16-bit; off = 8-bit
			data.setUint8(offset, converter.options.bitDepth === 16 ? 0x03 : 0x01);
			offset++;

			// Vol - default volume for instrument
			data.setUint8(offset, 0x40);
			offset++;

			// Skip sample name
			offset += 26;

			// Cvt / convert (bitmask; bit 1 on = signed samples; off = unsigned)
			// IT 2.02 and above use signed samples
			// OpenMPT appears to automatically convert 8-bit unsigned audio to signed
			data.setUint8(offset, 0x01);
			offset++;

			// DfP / default pan
			data.setUint8(offset, 0x20);
			offset++;

			// Length - length of sample in no. of samples (not bytes)
			data.setUint32(offset, wavData[i].sampleLength, true);
			offset += 4;

			// Loop Begin - start of loop (no of samples in, not bytes)
			// ignored
			offset += 4;

			// Loop End - sample no. AFTER end of loop
			// ignored
			offset += 4;

			// C5Speed - number of bytes a second for C-5 (ranges from 0->9999999)
			data.setUint32(offset, converter.options.sampleRate, true);
			offset += 4;

			// SusLoop Begin - start of sustain loop
			// ignored
			offset += 4;

			// SusLoop End - sample no. AFTER end of sustain loop
			// ignored
			offset += 4;

			// SamplePointer - offset of sample in file (the WAV data)
			const prevSampleSize = wavData[i-1] !== undefined ? wavData[i-1].byteLength - 44 : 0;

			data.setUint32(offset, headerSize + (SmpNum * 0x50) + 8 + (SmpNum * 4) + totalRows + prevSampleSize, true);
			offset += 4;

			// ViS - vibrato speed
			// ViD - vibrato depth
			// ViR - vibrato waveform type
			// ViT - vibrato rate, rate at which vibrato is applied
			// ignored
			offset += 4;
		}

		/**
		 * Impulse Pattern
		 */
		// Length - length of packed pattern, NOT including the 8 byte header
		data.setUint16(offset, (SmpNum * 4) + (SmpNum * converter.options.extraChannels * 4) + totalRows, true);
		offset += 2;

		// Rows - number of rows in this pattern
		data.setUint16(offset, totalRows, true);
		offset += 2;

		// blank
		offset += 4;

		// Packed pattern - values below correspond to "C-5 01 v64 ..." etc.
		let channelNo = 0x81;

		for (let i = 1; i <= SmpNum; i++) {
			data.setUint8(offset, channelNo);
			offset++;
			channelNo++;

			data.setUint8(offset, 0x03);
			offset++;

			data.setUint8(offset, 0x3C);
			offset++;

			data.setUint8(offset, i);
			offset++;

			// Channels may be duplicated to increase volume
			for (let j = 0; j < converter.options.extraChannels; j++) {
				data.setUint8(offset, channelNo);
				offset++;
				channelNo++;

				data.setUint8(offset, 0x03);
				offset++;

				data.setUint8(offset, 0x3C);
				offset++;

				data.setUint8(offset, i);
				offset++;
			}
		}

		// One null byte per row (in this case, total duration of input audio)
		offset += totalRows;

		for (const channel of wavData) {
			const wavDataView = new DataView(channel.slice(44));

			for (let i = 0; i < wavDataView.byteLength; i++) {
				data.setUint8(offset, wavDataView.getUint8(i));
				offset++;
			}
		}

		return data;
	}

	this.impulseToUMX = function(impulseData) {
		class UMX {
			constructor(flags, nameTable, importTable, exportTable, musicObject) {
				this.signature   = 0xC1832A9E;
				this.version     = 69;
				this.flags       = flags;
				this.nameTable   = new NameTable(nameTable);
				this.musicObject = new UMusic(...musicObject);
				this.importTable = new ImportTable(importTable);
				this.exportTable = new ExportTable(exportTable);
				this.guid        = this.getUUIDv4();

				// Hack.
				// Adding the UMusic class object here directly as this will only ever be used for one object.
				// A better way would be something like: package.exportTable.add(musicObject);
				// To-do.
				this.exportTable.objects[0].objectSize   = converter.toCompactIndex(this.musicObject.length);
				this.exportTable.objects[0].objectOffset = converter.toCompactIndex(0x40 + this.nameTable.length);
			}

			get length() {
				return 0x40 + this.nameTable.length + this.musicObject.length + this.importTable.length + this.exportTable.length;
			}

			serialize = function() {
				const buffer = new ArrayBuffer(this.length);
				const data   = new DataView(buffer);

				let offset = 0;

				/**
				 * Package header
				 */
				data.setUint32(offset, this.signature);
				offset += 4;

				data.setUint32(offset, this.version, true);
				offset += 4;

				data.setUint32(offset, this.flags, true);
				offset += 4;

				data.setUint32(offset, this.nameTable.objects.length, true);
				offset += 4;

				// Name table offset
				// Appears immediately after header
				data.setUint32(offset, 0x40, true);
				offset += 4;

				// Export table count
				// Only one export object (the audio)
				data.setUint32(offset, this.exportTable.objects.length, true);
				offset += 4;

				// Export table offset
				data.setUint32(offset, 0x40 + this.nameTable.length + this.musicObject.length + this.importTable.length, true);
				offset += 4;

				// Import table count
				// Engine and Music classes
				data.setUint32(offset, this.importTable.objects.length, true);
				offset += 4;

				// Import table offset
				data.setUint32(offset, 0x40 + this.nameTable.length + this.musicObject.length, true);
				offset += 4;

				// GUID
				// Unreal Engine uses Windows CoCreateGuid function
				for (const byte of this.guid) {
					data.setUint8(offset, byte);
					offset++;
				}

				// Generation count
				data.setUint32(offset, 1, true);
				offset += 4;

				// Generation 1 export table count - same as above
				data.setUint32(offset, this.exportTable.objects.length, true);
				offset += 4;

				// Generation 1 name table count - same as above
				data.setUint32(offset, this.nameTable.objects.length, true);
				offset += 4;

				/**
				 * Package name table
				 */
				for (const nameObject of this.nameTable.objects) {
					// Length byte (includes terminator)
					data.setUint8(offset, nameObject.name.length + 1);
					offset++;

					// Name
					converter.writeString(data, offset, nameObject.name);
					offset += nameObject.name.length;

					// Null terminator
					offset++;

					// Object flags
					data.setUint32(offset, nameObject.flags, true);
					offset += 4;
				}

				/**
				 * Unreal Music class (the audio)
				 */
				// Object properties
				// 1 = index into name table ("None", as there are no properties)
				data.setUint8(offset, this.musicObject.properties);
				offset++;

				// Audio format
				// 0 = index into name table ("it")
				data.setUint8(offset, this.musicObject.format.value);
				offset++;

				// Offset to end of audio data
				data.setUint32(offset, 0x40 + this.nameTable.length + this.musicObject.length, true);
				offset += 4;

				// Audio data size (in compact index format)
				for (let i = this.musicObject.musicSize.length - 1; i >= 0; i--) {
					data.setUint8(offset, (this.musicObject.musicSize.value >> (i * 8)) & 0xFF);
					offset++;
				}

				// Audio data
				for (let i = 0; i < this.musicObject.musicData.byteLength; i++) {
					data.setUint8(offset, this.musicObject.musicData.getUint8(i));
					offset++;
				}

				/**
				 * Import table
				 */
				for (const object of this.importTable.objects) {
					for (let i = object.classPackageIndex.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.classPackageIndex.value >> (i * 8)) & 0xFF);
						offset++;
					}

					for (let i = object.classNameIndex.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.classNameIndex.value >> (i * 8)) & 0xFF);
						offset++;
					}

					data.setUint32(offset, object.packageIndex, true);
					offset += 4;

					for (let i = object.objectNameIndex.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.objectNameIndex.value >> (i * 8)) & 0xFF);
						offset++;
					}
				}

				/**
				 * Export table
				 */
				for (const object of this.exportTable.objects) {
					for (let i = object.classIndex.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.classIndex.value >> (i * 8)) & 0xFF);
						offset++;
					}

					for (let i = object.superIndex.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.superIndex.value >> (i * 8)) & 0xFF);
						offset++;
					}

					data.setUint32(offset, object.packageIndex, true);
					offset += 4;

					for (let i = object.objectName.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.objectName.value >> (i * 8)) & 0xFF);
						offset++;
					}

					data.setUint32(offset, object.objectFlags, true);
					offset += 4;

					for (let i = object.objectSize.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.objectSize.value >> (i * 8)) & 0xFF);
						offset++;
					}

					for (let i = object.objectOffset.length - 1; i >= 0; i--) {
						data.setUint8(offset, (object.objectOffset.value >> (i * 8)) & 0xFF);
						offset++;
					}
				}

				return data;
			}

			getUUIDv4 = function() {
				if (typeof window.crypto !== "object") {
					throw "Crypto interface unavailable";
				}

				// Return as array of bytes
				return crypto.randomUUID().replace(/-/g, "").match(/.{2}/g).map(b => parseInt(b, 16));
			}
		}

		class NameTable {
			constructor(nameObjects) {
				this.objects = new Array(nameObjects.length);
				this.length = 0;

				for (let i = 0; i < nameObjects.length; i++) {
					this.objects[i] = new NameTableObject(...nameObjects[i]);
					this.length += this.objects[i].length;
				}
			}
		}

		class ImportTable {
			constructor(importObjects) {
				this.objects = new Array(importObjects.length);
				this.length = 0;

				for (let i = 0; i < importObjects.length; i++) {
					this.objects[i] = new ImportTableObject(...importObjects[i]);
					this.length += this.objects[i].length;
				}
			}
		}

		class ExportTable {
			constructor(exportObjects) {
				this.objects = new Array(exportObjects.length);

				for (let i = 0; i < exportObjects.length; i++) {
					this.objects[i] = new ExportTableObject(...exportObjects[i]);
				}
			}

			get length() {
				return this.objects.reduce((total, obj) => total + obj.length, 0);
			}
		}

		class NameTableObject {
			constructor(name, flags) {
				this.name  = name;
				this.flags = flags;

				this.length = 1 + name.length + 1 + 4;
			}
		}

		class ImportTableObject {
			constructor(classPackageIndex, classNameIndex, packageIndex, objectNameIndex) {
				this.classPackageIndex = converter.toCompactIndex(classPackageIndex);
				this.classNameIndex    = converter.toCompactIndex(classNameIndex);
				this.packageIndex      = packageIndex;
				this.objectNameIndex   = converter.toCompactIndex(objectNameIndex);

				this.length = this.classPackageIndex.length + this.classNameIndex.length + 4 + this.objectNameIndex.length;
			}
		}

		class ExportTableObject {
			constructor(classIndex, superIndex, packageIndex, objectName, objectFlags, objectOffset) {
				this.classIndex   = converter.toCompactIndex(classIndex);
				this.superIndex   = converter.toCompactIndex(superIndex);
				this.packageIndex = packageIndex;
				this.objectName   = converter.toCompactIndex(objectName);
				this.objectFlags  = objectFlags;
				this.objectSize   = converter.toCompactIndex(0);
				this.objectOffset = converter.toCompactIndex(objectOffset);
			}

			get length() {
				return this.classIndex.length + this.superIndex.length + 4 + this.objectName.length + 4 + this.objectSize.length + this.objectOffset.length;
			}
		}

		class UMusic {
			constructor(properties, format, musicSize, musicData) {
				this.properties = properties; // hardcoding properties here as it's always the same
				this.format     = converter.toCompactIndex(format);
				this.musicSize  = converter.toCompactIndex(musicSize);
				this.musicData  = musicData;

				this.length = 1 + this.format.length + 4 + this.musicSize.length + this.musicData.byteLength;
			}
		}

		// Object flags
		const
			RF_Public          = 0x00000004,
			RF_TagExp          = 0x00000010,
			RF_HighlightedName = 0x00000400,
			RF_LoadForClient   = 0x00010000,
			RF_LoadForServer   = 0x00020000,
			RF_LoadForEdit     = 0x00040000,
			RF_Standalone      = 0x00080000,
			RF_Native          = 0x04000000;

		const nameTable = [
			["it",                   RF_TagExp | RF_LoadForClient   | RF_LoadForServer | RF_LoadForEdit],
			["None",                 RF_TagExp | RF_HighlightedName | RF_LoadForClient | RF_LoadForServer | RF_LoadForEdit | RF_Native],
			["Package",              RF_TagExp | RF_HighlightedName | RF_LoadForClient | RF_LoadForServer | RF_LoadForEdit | RF_Native],
			["Class",                RF_TagExp | RF_HighlightedName | RF_LoadForClient | RF_LoadForServer | RF_LoadForEdit | RF_Native],
			["Music",                RF_TagExp | RF_LoadForClient   | RF_LoadForServer | RF_LoadForEdit],
			[converter.options.name, RF_TagExp | RF_LoadForClient   | RF_LoadForServer | RF_LoadForEdit],
			["Engine",               RF_TagExp | RF_LoadForClient   | RF_LoadForServer | RF_LoadForEdit   | RF_Native],
			["Core",                 RF_TagExp | RF_LoadForClient   | RF_LoadForServer | RF_LoadForEdit   | RF_Native],
		];

		const importTable = [
			[
				7,  // Class package - "Core"
				3,  // Class name    - "Class"
				-2, // Package       - "Engine" - (negative value = import table index)
				4,  // Object name   - "Music"
			],
			[
				7,  // Class package - "Core"
				2,  // Class name    - "Package"
				0,  // Package       - "None"
				6,  // Object name   - "Engine"
			],
		];

		const exportTable = [
			[
				-1,     // Class index - "Music" - reference to import table
				0,      // Super index - "None"
				0,      // Package     - "None"
				5,      // Object name - filename as specified in this converter's options object
				RF_Public | RF_LoadForClient | RF_LoadForServer | RF_LoadForEdit | RF_Standalone,
			],
		];

		const musicObject = [
			1, // Properties - "None"
			0, // Format     - "it"
			impulseData.byteLength,
			impulseData,
		];

		const umx = new UMX(
			1, // PKG_AllowDownload
			nameTable,
			importTable,
			exportTable,
			musicObject,
		);

		return umx.serialize();
	}

	// From Tim Sweeney's FCompactIndex serializer.cpp
	this.toCompactIndex = function(value) {
		const bytes = [];

		let V = Math.abs(value);

		const B0 = ((value >= 0) ? 0 : 0x80) + ((V < 0x40) ? V : ((V & 0x3f) + 0x40));

		bytes.push(B0);

		if (B0 & 0x40) {
			V >>= 6;

			const B1 = (V < 0x80) ? V : ((V & 0x7f) + 0x80);

			bytes.push(B1);

			if (B1 & 0x80) {
				V >>= 7;

				const B2 = (V < 0x80) ? V : ((V & 0x7f) + 0x80);

				bytes.push(B2);

				if (B2 & 0x80) {
					V >>= 7;

					const B3 = (V < 0x80) ? V : ((V & 0x7f) + 0x80);

					bytes.push(B3);

					if (B3 & 0x80) {
						V >>= 7;

						const B4 = V;

						bytes.push(B4);
					}
				}
			}
		}

		const output = {
			length : bytes.length,
			value  : parseInt(bytes.map(b => b.toString(16).padStart(2, 0)).join(""), 16),
		}

		return output;
	}

	/**
	 * The following (modified) functions are copied from https://github.com/Jam3/audiobuffer-to-wav
	 */
	this.audioBufferToWav = function(inputAudio) {
		const channels = [];

		// Stereo = true AND at least 2 channels
		if (converter.options.stereo && inputAudio.numberOfChannels >= 2) {

			// Convert L/R channels to separate WAV buffers to be used as Impulse Samples
			for (let i = 0; i < 2; i++) {
				const wav = converter.encodeWAV(
					inputAudio.getChannelData(i)
				);

				channels.push(wav);
			}

		}

		// Stereo == false OR only 1 channel
		else {

			// Downmix L/R channels to mono
			if (inputAudio.numberOfChannels > 1) {
				const wav = converter.encodeWAV(
					converter.mergeChannels(inputAudio.getChannelData(0), inputAudio.getChannelData(1))
				);

				channels.push(wav);
			}

			// Input audio is single channel
			else {
				const wav = converter.encodeWAV(
					inputAudio.getChannelData(0)
				);

				channels.push(wav);
			}

		}

		return channels;
	}

	this.encodeWAV = function(samples) {
		var format = 1 // Raw PCM
		var numChannels = 1
		var bytesPerSample = converter.options.bitDepth / 8
		var blockAlign = numChannels * bytesPerSample

		var buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
		var view = new DataView(buffer)

		/* RIFF identifier */
		converter.writeString(view, 0, 'RIFF')
		/* RIFF chunk length */
		view.setUint32(4, 36 + samples.length * bytesPerSample, true)
		/* RIFF type */
		converter.writeString(view, 8, 'WAVE')
		/* format chunk identifier */
		converter.writeString(view, 12, 'fmt ')
		/* format chunk length */
		view.setUint32(16, 16, true)
		/* sample format (raw) */
		view.setUint16(20, format, true)
		/* channel count */
		view.setUint16(22, numChannels, true)
		/* sample rate */
		view.setUint32(24, converter.options.sampleRate, true)
		/* byte rate (sample rate * block align) */
		view.setUint32(28, converter.options.sampleRate * blockAlign, true)
		/* block align (channel count * bytes per sample) */
		view.setUint16(32, blockAlign, true)
		/* bits per sample */
		view.setUint16(34, converter.options.bitDepth, true)
		/* data chunk identifier */
		converter.writeString(view, 36, 'data')
		/* data chunk length */
		view.setUint32(40, samples.length * bytesPerSample, true)
		/* audio samples */
		if (converter.options.bitDepth === 8) {
			converter.floatTo8BitPCM(view, 44, samples)
		} else {
			converter.floatTo16BitPCM(view, 44, samples)
		}

		buffer.sampleLength = samples.length

		return buffer
	}

	this.mergeChannels = function(inputL, inputR) {
		var result = new Float32Array(inputL.length)

		var index = 0
		var inputIndex = 0

		while (index < inputL.length) {
			result[index++] = (inputL[inputIndex] + inputR[inputIndex]) / 2
			inputIndex++
		}

		return result
	}

	this.floatTo8BitPCM = function(output, offset, input) {
		for (var i = 0; i < input.length; i++, offset++) {
			const sample = Math.max(-1, Math.min(1, input[i]))
			output.setInt8(offset, sample < 0 ? sample * 0x80 : sample * 0x7F)
		}
	}

	this.floatTo16BitPCM = function(output, offset, input) {
		for (var i = 0; i < input.length; i++, offset += 2) {
			const sample = Math.max(-1, Math.min(1, input[i]))
			output.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
		}
	}

	this.writeString = function(view, offset, string) {
		for (var i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i))
		}
	}
}
