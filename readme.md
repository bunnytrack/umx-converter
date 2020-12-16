# MP3 to UMX Converter

_By Sapphire_

A JavaScript plugin for converting MP3 files to Unreal Music (.UMX) and Impulse Tracker (.IT) formats. This plugin uses the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API), so several other input formats are also accepted. This has been made for use with Unreal Tournament GOTY 1999.

See it in action at https://bunnytrack.net/umx-converter/


## Background

Although there are several guides online detailing how to convert to UMX, many of them contain conflicting information and offer little to no technical explanation of the steps involved. Most guides, for example, state that the input audio _must_ be downmixed to a single channel, however this is simply not true (the default UT music packages are in stereo, after all).

This plugin aims to simplify the process to a single drag and drop operation, as well as providing options for decreasing the file size by reducing the sample rate, bit depth, and number of channels.


## How to Use

Create an instance of `UMXConverter` and call the `convert` method, passing an object of options. The only required option is `input`, which should be an `ArrayBuffer` as shown in the following example:

```html
<input type="file" id="file-input" />

<script src="./umx-converter.js"></script>
<script>
    document.getElementById("file-input").addEventListener("input", function() {
        const file   = this.files[0];
        const reader = new FileReader();

        reader.onload = function() {
            const converter = new UMXConverter();

            converter.convert({
                input: this.result
            })
        }

        reader.readAsArrayBuffer(file);
    })
</script>
```

This will prompt a file download for _output.umx_ with the default conversion options (see below).


## Options

| Name            | Default value | Type                 | Description                                                                                                                         |
| ---             | ---           | ---                  | ---                                                                                                                                 |
| `input`         | —             | Object (ArrayBuffer) | The input audio data to be converted.                                                                                               |
| `format`        | `"umx"`       | String               | Output format for the converted audio. Must be `umx` or `it`.                                                                       |
| `bitDepth`      | `16`          | Number               | Output bit depth. Tested with `16` and `8`.                                                                                         |
| `sampleRate`    | `22050`       | Number               | Output sample rate. Tested with `44100`, `22050`, and `11025`.                                                                      |
| `stereo`        | `true`        | Bool                 | If `true`, output audio will be stereo (if input is mono then this will be ignored); if `false`, L/R channels will be combined.     |
| `extraChannels` | `2`           | Number               | How many times to duplicate each channel in the Impulse Tracker file. This is useful for boosting the volume.                       |
| `name`          | `"output"`    | String               | Output file name.                                                                                                                   |
| `success`       | `null`        | Function             | Function called on successful conversion. No parameters are passed to this function (as the file download is prompted immediately). |
| `error`         | `null`        | Function             | Function called when an error is encountered in the conversion process. A single argument, `error`, is passed to this function.     |
