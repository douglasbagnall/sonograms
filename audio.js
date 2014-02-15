//var wav_1_minute = 'RFPT-WW13-20111229213002-540-60-KR8.wav';
//var wav_1_minute = 'moreporks/RFPT-WWMB-20111208230002-240-60-KR3.wav';
var wav_1_minute = 'moreporks/RFPT-WW17-20111111220002-0-60-KR4.wav';
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
    var sum = 0;
    for (i = 0; i < length; i++){
        var x = 0.5 - 0.5 * Math.cos(tau_norm * i);
        window[i] = x;
        sum += x;
    }
    for (i = 0; i < length; i++){
        window[i] /= sum;
    }
    return window;
}

function vorbis_window(length){
    var i;
    var window = new Float32Array(length);
    var pi_norm = Math.PI / length;
    var half_pi = Math.PI / 2;
    var sum = 0;
    for (i = 0; i < length; i++){
      var z = pi_norm * (i + 0.5);
      var x = Math.sin(half_pi * Math.sin(z) * Math.sin(z));
      window[i] = x;
      sum += x;
    }
    for (i = 0; i < length; i++){
        window[i] /= sum;
    }
    return window;
}



function median(original, low, high){
    if (high - low < 2){
        return original[low];
    }
    var array = new Float32Array(original.subarray(low, high));
    var left = 0;
    var right = array.length;
    var k = right >>> 1;
    while (1){
        var pivot = array[right - 1];
        var j = left;
        for (i = left; i < right; i++){
            var v = array[i];
            if (v < pivot){
                array[i] = array[j];
                array[j] = v;
                j++;
            }
        }
        array[right - 1] = array[j];
        array[j] = pivot;
        var p = j;

        if (k == j){
            return array[k];
        }
        if (k < j){
            right = j;
        }
        else {
            left = j + 1;
        }
    }
}


function get_morepork_intensity(spectrogram, lf, hf){
    var i, j;
    var low_band = spectrogram.hz2band(lf);
    var top_band = spectrogram.hz2band(hf);

    var series = {
        peak_minus_med: new Float32Array(spectrogram.width),
        peak_over_med: new Float32Array(spectrogram.width),
        peak_index: new Float32Array(spectrogram.width),
        medians: new Float32Array(spectrogram.width),
        means: new Float32Array(spectrogram.width),
        stddevs: new Float32Array(spectrogram.width),
        peaks: new Float32Array(spectrogram.width),
        peak_over_mean: new Float32Array(spectrogram.width)
    };
    for (i = 0; i < spectrogram.width; i++){
        var peak = 0;
        var sum = 0;
        var sumsq = 0;
        var window = spectrogram.data.subarray(i * spectrogram.height,
                                               (i + 1) * spectrogram.height);
        var peak_index = 0;
        for (j = low_band; j <= top_band; j++){
            var x = window[j];
            if (x > peak){
                peak = x;
                peak_index = j;
            }
            sum += x;
            sumsq += x * x;
        }
        var n = top_band - low_band + 1;
        var mean = sum / n;
        var stddev = Math.sqrt((sumsq - sum * mean) / n);
        var med = median(window, low_band, top_band);
        series.peak_minus_med[i] = peak - med;
        series.peak_over_med[i] = peak / med;
        series.peak_over_mean[i] = peak / mean;
        series.peaks[i] = peak;
        series.peak_index[i] = peak_index - low_band;
        series.means[i] = mean;
        series.medians[i] = med;
        series.stddevs[i] = stddev;
    }
    series.peak_index_delta = new Float32Array(spectrogram.width);
    series.peak_index_d2 = new Float32Array(spectrogram.width);
    series.peak_index_delta[0] = 0;
    series.peak_index_d2[0] = series.peak_index_d2[1] = 0;
    series.peak_index_delta[0] = series.peak_index[1] - series.peak_index[0];
    var d2 = 0;
    for (i = 2; i < spectrogram.width; i++){
        var d = series.peak_index[i] - series.peak_index[i - 1];
        series.peak_index_delta[i] = Math.abs(d);
        series.peak_index_d2[i] = 1 / (0.1 + d - d2);
        d2 = d;
    }
    return series;
}


function morepork_detector(spectrogram, lower_freq, upper_freq){
    var i, j;
    console.time('morepork intensity');
    var mdata = get_morepork_intensity(spectrogram, lower_freq, upper_freq);
    console.timeEnd('morepork intensity');
    console.time('morepork paint');

    var canvas = document.getElementById("debug");
    var context = canvas.getContext('2d');
    var colours = ['#FFFF00', '#FFaa00', '#00cc00', '#FF0011', '#00FFFF', '#FF33FF'];
    var keys = Object.keys(mdata);
    keys.sort();
    var step = canvas.height / keys.length;
    context.fillStyle = "#ffffff";

    for (j = 0; j < keys.length; j++){
        var attr = keys[j];
        var array = mdata[attr];
        var colour = colours[j];
        console.log(attr, array[0], colour);
        context.beginPath();
        context.strokeStyle = colour;
        var max = 1e-6;

        for (i = 0; i < array.length; i++){
            max = (array[i] > max) ? array[i] : max;
        }
        var scale =  (step - 1) / max;
        var offset = step * (j + 1);

        context.moveTo(0, offset - array[0] * scale);
        for (i = 1; i < array.length; i++){
            context.lineTo(i, offset - 1 - array[i] * scale);
        }
        context.stroke();
        context.fillText(attr, 10, offset - step / 2);
    }
    console.timeEnd('morepork paint');
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
        duration: audio.duration,
        hz2band: function(x) {
            return parseInt(x / this.band_width);
        }
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
                           low_hz, high_hz, squash){
    var i, j;
    var left, col, row;
    squash = squash || 1;
    var low_band = parseInt(spectrogram.hz2band(low_hz) / squash);
    var high_band = parseInt(spectrogram.hz2band(high_hz) / squash);
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
        var base_offset = ((row * row_height * width + col) * 4  +
                           low_band * pixwidth + (high_band - low_band) * pixwidth);
        for (i = low_band; i < high_band; i++){
            var o = base_offset - i * pixwidth;
            var v2 = s[i * squash];
            var v = Math.sqrt(v2 + 1e-7);
            pixels[o] = v2 * 1e6 + v2 * v2 * 2e6;
            pixels[o + 1] = v2 / (v + 0.03) * 6e4 - v * 1e4;
            pixels[o + 2] = v * 1e4 - v2 * v * 3e7;
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
    var width_in_seconds = 60;

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
                                   width_in_seconds, 600, 1500, 1);

    console.log(spectrogram);

    var LOWER_FREQ = 700;
    var UPPER_FREQ = 1100;

    console.time('morepork_detector');
    morepork_detector(spectrogram, LOWER_FREQ, UPPER_FREQ);
    console.timeEnd('morepork_detector');


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
