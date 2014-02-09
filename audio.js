var wav_1_minute = 'RFPT-WW13-20111229213002-540-60-KR8.wav';
var wav_15_minute = "RFPT-WW10A-2013-02-14T02.00.10-KR5.wav";
var URL = wav_15_minute;

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
        scale = 1.0 / 256;
    }
    else if (bits_per_sample == 16){
        samples = new Int16Array(data);
        scale = 1.0 / 32768;
    }
    var normalised_samples = new Float32Array(samples.length / channels);
    for (var i = 0; i < normalised_samples.length; i++){
        normalised_samples[i] = samples[i * channels] * scale;
    }
    return {
        audio: normalised_samples,
        samplerate: samplerate
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

function calculate_spectrogram(audio, window_size, samplerate, spacing){
    var i, left, j;
    var fft = new FFT(window_size, samplerate);
    var mask_window = hann_window(window_size);
    var data_window = new Float32Array(window_size);
    var window_padding = 10;
    var spectrogram_height = parseInt(window_size / 2);
    var spectrogram_length = parseInt(audio.length / window_size);
    var spectrogram = new Float32Array(spectrogram_length * spectrogram_height);
    for (j = 0; j < spectrogram_length; j++){
        left = j * spacing;
        var square_window = audio.subarray(left, left + window_size);
        for (i = 0; i < window_size; i++){
            data_window[i] = square_window[i] * mask_window[i];
        }
        fft.forward(data_window);
        spectrogram.set(fft.spectrum, j * spectrogram_height);
    }
    return {
        width: spectrogram_length,
        height: spectrogram_height,
        data: spectrogram
    };
}


function paint_spectrogram(spectrogram, pixels, width, height,
                           row_height){
    var i;
    var left, col, row;
    var window_padding = 10;
    var spectrum_low = 20;
    var spectrum_high = 200;
    var pixwidth = width * 4;
    var s_data = spectrogram.data;
    var s_width = spectrogram.width;
    var s_height = spectrogram.height;
    for (j = 0, col = 0, row = 0;
         j < s_width;
         j++, col++){
        var x  = j * s_height;
        var s = s_data.subarray(x, x + s_height);
        var base_offset = (((row + 1) * row_height + window_padding) * width + col) * 4;
        for (i = spectrum_low; i < spectrum_high; i++){
            var o = base_offset - i * pixwidth;
            var v = s[i * 2] + s[i * 2 + 1];
            pixels[o] = v * v * 6e8;
            pixels[o + 1] = v * 3e5;// + Math.sin(v * 1e3) * 50;
            pixels[o + 2] = Math.sqrt(v) * 6e3;
            pixels[o + 3] = 255;
        }
        if (col >= width){
            col -= width;
            row++;
            console.log(col, row);
        }
    }
}

function fill_canvas(audio, samplerate, native_audio){
    var canvas = document.getElementById('fft');
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var pixel2sec = 120 / width;
    var row_height = 200;
    var height = Math.ceil(audio.length / samplerate / 120) * row_height;
    canvas.height = height;
    var audio_source;
    var window_size = 1024;
    var spacing = 120 * samplerate / (width); /* fit 2 minutes across */

    console.time('calculate_spectrogram');
    var spectrogram = calculate_spectrogram(audio, window_size, samplerate, spacing);
    console.timeEnd('calculate_spectrogram');
    console.time('paint_spectrogram');
    var imgdata = context.createImageData(canvas.width, canvas.height);
    var pixels = imgdata.data;
    paint_spectrogram(spectrogram,
                      pixels, canvas.width, canvas.height, row_height);
    console.timeEnd('paint_spectrogram');
    console.time('putImageData');
    context.putImageData(imgdata, 0, 0);
    console.timeEnd('putImageData');


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
                var norm = parse_wav(wav);
                fill_canvas(norm.audio, norm.samplerate, audio);
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
