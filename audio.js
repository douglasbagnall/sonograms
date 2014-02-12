var wav_1_minute = 'RFPT-WW13-20111229213002-540-60-KR8.wav';
var wav_15_minute = "RFPT-WW10A-2013-02-14T02.00.10-KR5.wav";
var URL = wav_1_minute;

var COLOUR_LUT = {
    k: "#0ff",
    m: "#f00",
    f: "#0f0",
    r: "#ff0",
    n: "#f0f",
    e: "#000"
};


var audio_context;

function parse_wav(raw){
    /*   https://ccrma.stanford.edu/courses/422/projects/WaveFormat/ */
    var header = new DataView(raw, 0, 44);
    var data = raw.slice(44);
    var i;
    if (header.getUint32(0, 0) != 0x52494646 || //'RIFF'
        header.getUint32(8, 0) != 0x57415645 || //'WAVE'
        header.getUint16(20, 1) != 1         || //format (pcm == 1)
        header.getUint32(40, 1) != data.byteLength  //length should match data
       ){
       message("I can't understand this file. Is it really a WAV?" +
               " (Continuing regardless...)");
       console.log(header.getUint32(0, 0), 0x52494646,
       header.getUint32(8, 0), 0x57415645,
       header.getUint16(16, 1), 1,
       header.getUint32(40, 1), data.byteLength);
    }
    var samplerate = header.getUint32(24, 1);
    /*if there are more than one channel, just silently grab the first one */
    var channels = header.getUint16(22, 1);
    var bits_per_sample = header.getUint16(34, 1);
    var samples, scale;
    if (bits_per_sample == 8){
        samples = new Int8Array(data);
        //scale = 1.0 / 256;
    }
    else if (bits_per_sample == 16){
        samples = new Int16Array(data);
        //scale = 1.0 / 32768;
    }
    var normalised_samples = new Float32Array(samples.length / channels);

    var sqsum = 0;
    for (i = 0; i < normalised_samples.length; i++){
        var x = samples[i * channels];
        sqsum += x * x;
    }
    scale = 1.0 / Math.sqrt(sqsum / normalised_samples.length);
    for (i = 0; i < normalised_samples.length; i++){
        normalised_samples[i] = samples[i * channels] * scale;
    }
    return {
        samples: normalised_samples,
        samplerate: samplerate,
        duration: normalised_samples.length / samplerate
    };
}

function hann_window(length){
    var i;
    var window = new Float32Array(length);
    var tau_norm = Math.PI * 2 / length;
    for (i = 0; i < length; i++){
        window[i] = 0.5 - 0.5 * Math.cos(tau_norm * i);
    }
    return window;
}

function vorbis_window(length){
    var i;
    var window = new Float32Array(length);
    var pi_norm = Math.PI / length;
    var half_pi = Math.PI / 2;
    for (i = 0; i < length; i++){
      var z = pi_norm * (i + 0.5);
      window[i] = Math.sin(half_pi * Math.sin(z) * Math.sin(z));
    }
    return window;
}

function simple_detector(spectrogram, bands){
    var b, i, j, k;
    for (i = 0; i < bands.length; i++){
        b = bands[i];
        b.intensity = new Float32Array(spectrogram.width);
    }
    var data = spectrogram.data;
    var h = spectrogram.height;
    console.log('spec', spectrogram);
    var hz2iband = function(x) {
        return parseInt(x / spectrogram.band_width);
    };

    for (i = 0; i < bands.length; i++){
        b = bands[i];
        var good_low = hz2iband(b.good_audio_hz_low);
        var good_high = hz2iband(b.good_audio_hz_high);
        var bad_low = hz2iband(b.bad_audio_hz_low);
        var bad_high = hz2iband(b.bad_audio_hz_high);
        console.log('good', good_low, good_high,
                    'bad', bad_low, bad_high
                    );
        for (j = 0; j < spectrogram.width; j++){
            var o = j * h;
            var window = data.subarray(o, o + h);
            var good = 0.0;
            for (k = good_low; k <= good_high; k++){
                good += window[k];
            }
            /*Subtract areas thought to be outside the band. This
             reduces the effect of vertically consistent oscillations
             like wind noise.*/
            var bad = 0.0;

            for (k = bad_low; k <= bad_high; k++){
                bad += window[k];
            }/*
            if (bad){
                bad *= (good_high - good_low) / (bad_high - bad_low);
            }*/
            b.intensity[j] = good - bad;
        }
    }

    var window_size = 128;
    var fft = new RFFT(window_size, spectrogram.windows_per_second);
    var spacing = parseInt(spectrogram.width / (spectrogram.duration * 3));
    var left;
    var data_window = new Float32Array(window_size);
    var mask_window = hann_window(window_size);
    var score_length = parseInt((spectrogram.width - window_size) / spacing) + 1;

    var hz2band = function(x){
        return parseInt(x / spectrogram.band_width * spectrogram.windows_per_second);
    };

    //var canvas = document.createElement("canvas");
    var canvas = document.getElementById("debug");
    canvas.width = score_length;
    canvas.height = window_size * bands.length;
    document.body.appendChild(canvas);
    var context = canvas.getContext('2d');

    for (i = 0; i < bands.length; i++){
        b = bands[i];

        var imgdata = context.createImageData(score_length, window_size);
        var pixels = imgdata.data;

        var syl_low = hz2band(b.good_syl_hz_low);
        var syl_high = hz2band(b.good_syl_hz_high);
        var noise_low = hz2band(b.bad_syl_hz_low);
        var noise_high = hz2band(b.bad_syl_hz_high);
        console.log(syl_low, syl_high, noise_low, noise_high);
        b.score = new Float32Array(score_length);
        for (j = 0; j < score_length; j++){
            left = j * spacing;
            var square_window = b.intensity.subarray(left, left + window_size);
            for (k = 0; k < window_size; k++){
                data_window[k] = square_window[k] * mask_window[k];
            }
            fft.forward(data_window);

            /*there are only a few frequencies that matter:
             low frequency signal and possibly high frequency contrast */
            var s = fft.spectrum;

            if (1){
                var step = imgdata.width * 4;
                var p = (imgdata.height - 10) * step + 4 * j;
                console.log(p);
                for (k = 0; k < s.length; k++, p-= step){
                    var v2 = s[k] * 2;
                    var v = Math.sqrt(v2 + 1e-9);
                    pixels[p] = v2 * 2e4;
                    pixels[p + 1] = v2 * v * 1e5 + 0.7 / v;
                    pixels[p + 2] = v * 7e2;
                    pixels[p + 3] = 255;
                }
            }

            k = syl_low;
            var signal = s[k];
            for (k++; k <= syl_high; k++){
                signal = (s[k] > signal) ? s[k] : signal;
            }
            var noise = 1e-6;
            for (k = noise_low; k <= noise_high; k++){
                noise += s[k];
                //console.log(k, s[k]);
            }
            /*
            console.log('syl', syl_low, syl_high, signal,
                        'noise', noise_low, noise_high, noise
                        );
             */

            if (isNaN(signal) || isNaN(noise)){
                console.log(j, syl_low, syl_high, noise_low, noise_high, window_size);
            }
            b.score[j] = Math.log(signal / noise);
        }
        console.log(b);
        context.putImageData(imgdata, 0, window_size * i);
        context.fillStyle = "#fff";
        context.fillText(b.name, 10, window_size * i + 40);
    }
    return bands;
}

function calculate_spectrogram(audio, window_size, spacing){
    var i, left, j;
    var fft = new RFFT(window_size, audio.samplerate);
    //var mask_window = hann_window(window_size);
    var mask_window = vorbis_window(window_size);
    var data_window = new Float32Array(window_size);
    var window_padding = 10;
    var height = parseInt(window_size / 2);
    var width = parseInt((audio.samples.length - window_size) / spacing) + 1;
    var spectrogram = new Float32Array(width * height);
    for (j = 0; j < width; j++){
        left = j * spacing;
        var square_window = audio.samples.subarray(left, left + window_size);
        for (i = 0; i < window_size; i++){
            data_window[i] = square_window[i] * mask_window[i];
        }
        fft.forward(data_window);
        spectrogram.set(fft.spectrum, j * height);
    }
    return {
        width: width,
        height: height,
        data: spectrogram,
        windows_per_second: audio.samplerate / spacing,
        band_width: audio.samplerate / window_size,
        duration: audio.duration
    };
}

function paint_detectors(bands, canvas, pixels, width_in_seconds, row_height){
    var i, j, b;
    for (i = 0; i < bands.length; i++){
        var col, row;
        for (j = 0, row = 0;
         j < b.score.length;
         j++){
            var base_offset = (((row + 1) * row_height) * width + col) * 4;

        }
    }
}

function paint_spectrogram(spectrogram, canvas,
                           row_height,
                           width_in_seconds,
                           low_band, high_band){
    var i, j;
    var left, col, row;
    var context = canvas.getContext('2d');
    var imgdata = context.createImageData(canvas.width, canvas.height);
    var pixels = imgdata.data;
    var s_data = spectrogram.data;
    var s_width = spectrogram.width;
    var s_height = spectrogram.height;
    var width = canvas.width;
    var pixel2sec = width_in_seconds / width;
    var height = Math.ceil(s_width / width_in_seconds /
                           spectrogram.windows_per_second) * row_height;
    canvas.height = height;
    console.time('paint_spectrogram');
    var pixwidth = width * 4;
    for (j = 0, col = 0, row = 0;
         j < s_width;
         j++, col++){
        var x  = j * s_height;
        var s = s_data.subarray(x, x + s_height);
        var base_offset = (((row + 1) * row_height) * width + col) * 4;
        for (i = low_band; i < high_band; i++){
            var o = base_offset - i * pixwidth;
            var v2 = s[i * 2] + s[i * 2 + 1];
            var v = Math.sqrt(v2 + 1e-9);
            pixels[o] = v2 * 2e4;
            pixels[o + 1] = v2 * v * 1e5 + 0.7 / v;
            pixels[o + 2] = v * 7e2;
            pixels[o + 3] = 255;
        }
        if (col >= width){
            col -= width;
            row++;
        }
    }
    console.log(spectrogram);
    console.timeEnd('paint_spectrogram');
    console.time('putImageData');
    context.putImageData(imgdata, 0, 0);
    console.timeEnd('putImageData');
    return pixels;
}

function fill_canvas(audio, native_audio){
    var canvas = document.getElementById('fft');
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var width_in_seconds = 120;

    var pixel2sec = width_in_seconds / width;
    var row_height = 220;
    var height = Math.ceil(audio.samples.length / audio.samplerate /
                           width_in_seconds) * row_height;
    canvas.height = height;
    var audio_source;
    var window_size = 1024;
    var spacing = width_in_seconds * audio.samplerate / width; /* fit 2 minutes across */

    console.time('calculate_spectrogram');
    var spectrogram = calculate_spectrogram(audio, window_size, spacing);
    console.timeEnd('calculate_spectrogram');
    var pixels = paint_spectrogram(spectrogram, canvas, row_height,
                                   width_in_seconds, 20, 200);

    console.log(spectrogram);

    var bands = [
        {name: "morepork",
         good_audio_hz_low: 750,
         good_audio_hz_high: 1100,
         bad_audio_hz_low: 550,
         bad_audio_hz_high: 700,
         good_syl_hz_low: 1,
         good_syl_hz_high: 4,
         bad_syl_hz_low: 7.5,
         bad_syl_hz_high: 17.3
        },
        {name: "kiwi",
         good_audio_hz_low: 1400,
         good_audio_hz_high: 1800,
         bad_audio_hz_low: 900,
         bad_audio_hz_high: 1200,
         good_syl_hz_low: 0.5,
         good_syl_hz_high: 1.4,
         bad_syl_hz_low: 7,
         bad_syl_hz_high: 17
        },
        {name: "weka",
         good_audio_hz_low: 1850,
         good_audio_hz_high: 2100,
         bad_audio_hz_low: 1400,
         bad_audio_hz_high: 1600,
         good_syl_hz_low: 0.7,
         good_syl_hz_high: 3,
         bad_syl_hz_low: 10,
         bad_syl_hz_high: 20
        }
    ];


    console.time('simple_detector');
    simple_detector(spectrogram, bands, audio.samplerate);
    console.timeEnd('simple_detector');


    function refill_background(){
        var data = context.getImageData(0, 0, canvas.width, canvas.height);
        var pix = data.data;
        for (var i = 0; i < pix.length; i += 4){
            if (pix[i] == 0 && pix[i + 1] == 0 && pix[i + 2] == 0){
                pix[i] = pixels[i];
                pix[i + 1] = pixels[i + 1];
                pix[i + 2] = pixels[i + 2];
            }
        }
        context.putImageData(data, 0, 0);
    }
    var drawing = 0;
    var playing_column = 0;
    var playing_row = 0;
    var hidden_data;
    var playing_column_interval;
    var colour = COLOUR_LUT['m'];
    var colour_label = document.getElementById("colour-m");
    colour_label.style.background = "#fc0";
    function switch_colour(c){
        if (colour === '#000'){
            refill_background();
        }
        var new_colour = COLOUR_LUT[c];
        if (new_colour !== undefined){
            colour_label.style.background = "#fff";
            colour_label = document.getElementById("colour-" + c);
            colour_label.style.background = "#fc4";
            colour = new_colour;
        }
    }

    for (var c in COLOUR_LUT){
        var label = document.getElementById("colour-" + c);
        label.onclick = function(x){
            return function(){switch_colour(x);};
        }(c);
    }
    function advance_playing_line(){
        context.putImageData(hidden_data, playing_column, playing_row * row_height);
        playing_column++;
        if (playing_column >= canvas.width){
            playing_column = 0;
            playing_row++;
        }
        hidden_data = context.getImageData(playing_column, playing_row * row_height,
                                           1, row_height);
        context.fillRect(playing_column, playing_row * row_height, 1, row_height);
    }
    function stop_playing(){
        if (audio_source !== undefined){
            audio_source.stop(0);
        }
        audio_source = undefined;
    }

    function start_playing_at_point(x, y){
        stop_playing();
        audio_source = audio_context.createBufferSource();
        audio_source.buffer = native_audio;
        audio_source.connect(audio_context.destination);
        var row = parseInt(y / row_height);
        audio_source.start(0, x * pixel2sec + row * 120);
        if (hidden_data !== undefined && playing_column !== undefined){
            context.putImageData(hidden_data, playing_column, playing_row * row_height);
        }
        playing_column = x;
        playing_row = row;
        context.fillStyle = "#ff3";
        hidden_data = context.getImageData(x, row * row_height, 1, row_height);
        context.fillRect(x, row * row_height, 1, row_height);
        playing_column_interval = window.setInterval(advance_playing_line,
                                                     pixel2sec * 1000);
        audio_source.onended = function(id){
            return function(){
                window.clearInterval(id);
            };
        }(playing_column_interval);
    }

    canvas.onclick = function(e){
        if (e.shiftKey){
            var x = e.pageX - this.offsetLeft;
            var y = e.pageY - this.offsetTop;
            start_playing_at_point(x, y);
        }
    };

    function draw_to(x, y, colour){
        context.lineTo(x, y);
        context.stroke();
    }
    canvas.onmousedown = function(e){
        if (! e.shiftKey){
            drawing = 1;
            var x = e.pageX - this.offsetLeft;
            var y = e.pageY - this.offsetTop;
            context.beginPath();
            context.lineWidth = 5;
	    context.lineJoin = 'round';
            context.strokeStyle = colour;
            context.moveTo(x, y);
            draw_to(x, y);
        }
    };
    document.onmouseup = function(e){
        drawing = 0;
    };
    canvas.onmousemove = function(e){
        if (drawing){
            draw_to(e.pageX - this.offsetLeft,
                    e.pageY - this.offsetTop);
        }
    };
    document.onkeypress = function(e){
        var c = String.fromCharCode(e.charCode);
        if (COLOUR_LUT[c] !== undefined){
            switch_colour(c);
        }
        else if (c == ' ' || c == 'p'){
            if (audio_source === undefined){
                start_playing_at_point(playing_column, playing_row * row_height);
            }
            else {
                stop_playing();
            }
            e.preventDefault();
        }
    };
}


function message(m){
    var el = document.getElementById('message');
    el.innerHTML += "<p>" +  m + "</p>";
}

function load_audio(url) {
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (! AudioContext){
        message("Web API seems to be missing from this browser.");
    }
    /*audio_context is global*/
    audio_context = new AudioContext();
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = function(){
        var wav = request.response;
        audio_context.decodeAudioData(wav,
            function(audio) {
                var parsed_audio = parse_wav(wav);
                fill_canvas(parsed_audio, audio);
            });
    };
    request.send();
}

function on_page_load() {
    if (document.location.protocol == 'file:'){
        message("<b>Warning:</b> this probably won't work from the local filesystem " +
                "(<tt>file://</tt> protocol), due to browser security settings. " +
                "<br>Use a local webserver, like webfsd.");
    }
    load_audio(URL);
}

window.addEventListener('load', on_page_load);
