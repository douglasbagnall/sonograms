
var MOREPORK_DEBUG = 0;

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
    var tau_norm = Math.PI * 2 / (length - 1);
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
    var pi_norm = Math.PI / (length - 1);
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

function padded_array(array, radius){
    /*extend the ends via reflection*/
    var padded = new Float32Array(array.length + radius * 2);
    var i;
    for (i = 0; i < array.length; i++){
        padded[radius + i] = array[i];
    }
    for (i = 0; i < radius; i++){
        padded[i] = array[radius - 1 - i];
        padded[array.length + radius + i] = array[array.length - i - 1];
    }
    return padded;
}

function convolve(array, window){
    var radius = parseInt((window.length + 1) / 2);
    var padded = padded_array(array, radius);
    var out = new Float32Array(array.length);
    var i, j;
    for (i = 0; i < array.length; i++){
        var sum = 0;
        for (j = 0; j < window.length; j++){
            sum += padded[i + j] * window[j];
        }
        out[i] = sum;
    }
    return out;
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

function running_median(array, radius){
    var out = new Float32Array(array.length);
    var padded = padded_array(array, radius);
    var i;
    for (i = 0; i < array.length; i++){
        out[i] = median(padded, i, i + 2 * radius + 1);
    }
   return out;
}

function get_morepork_intensity(spectrogram, lf, hf){
    var i, j;
    var low_band = spectrogram.hz2band(lf);
    var top_band = spectrogram.hz2band(hf);

    var series = {
        peak_minus_med: new Float32Array(spectrogram.width),
        peak_over_med: new Float32Array(spectrogram.width),
        peaks: new Float32Array(spectrogram.width)
    };

    var medians = new Float32Array(spectrogram.width);
    var peak_index = new Float32Array(spectrogram.width);
    for (i = 0; i < spectrogram.width; i++){
        var peak = 0;
        var sum = 0;
        var window = spectrogram.data.subarray(i * spectrogram.height,
                                               (i + 1) * spectrogram.height);
        var peak_i = 0;
        for (j = low_band; j <= top_band; j++){
            var x = window[j];
            if (x > peak){
                peak = x;
                peak_i = j;
            }
        }
        var n = top_band - low_band + 1;
        var med = median(window, low_band, top_band);
        series.peak_minus_med[i] = peak - med;
        series.peak_over_med[i] = peak / med;
        series.peaks[i] = peak;
        peak_index[i] = peak_i - low_band;
        medians[i] = med;
    }
    var hann3 = hann_window(3);
    var hann5 = hann_window(5);
    var hann7 = hann_window(7);
    var vorbis71 = vorbis_window(71);
    var vorbis11 = vorbis_window(11);
    var hann11 = hann_window(11);
    var hann19 = hann_window(19);
    series.smoothed_medians = convolve(medians, hann11);
    series.median_of_medians = running_median(medians, 50);
    series.smoothed_peaks_over_medians = convolve(series.peak_over_med, hann5);
    series.peak_index_delta = new Float32Array(spectrogram.width);
    var peak_index_d2 = new Float32Array(spectrogram.width);
    series.peak_index_d3 = new Float32Array(spectrogram.width);
    series.peak_index_delta[0] = 0;
    peak_index_d2[0] = peak_index_d2[1] = 0;
    series.peak_index_delta[0] = peak_index[1] - peak_index[0];
    var d2 = 0;
    for (i = 2; i < spectrogram.width; i++){
        var d = peak_index[i] - peak_index[i - 1];
        series.peak_index_delta[i] = Math.abs(d);
        peak_index_d2[i] = Math.abs(d - d2);
        series.peak_index_d3[i] = Math.abs(d2 * d);
        d2 = d;
    }
    series.peak_index = peak_index;
    series.peak_index_variance = peak_index;
    series.peak_ismoothed_d3 = convolve(series.peak_index_d3, hann19);
    series.median_d3 = running_median(series.peak_index_d3, 10);
    series.background = convolve(series.smoothed_peaks_over_medians, vorbis71);
    series.signal_over_background = new Float32Array(spectrogram.width);
    series.signal_minus_background = new Float32Array(spectrogram.width);
    var peak_index_variance = new Float32Array(spectrogram.width);
    var peak_index_smoothed = convolve(peak_index, hann7);
    var peak_index_smoothed2 = convolve(peak_index, hann5);

    for (i = 0; i < spectrogram.width; i++){
        series.signal_over_background[i] = (series.smoothed_peaks_over_medians[i] /
                series.background[i]);
        series.signal_minus_background[i] = (series.smoothed_peaks_over_medians[i] -
                series.background[i]);
    }
    series.bin_sos = new Float32Array(spectrogram.width);
    series.bin_d3 = new Float32Array(spectrogram.width);
    for (i = 0; i < spectrogram.width; i++){
        peak_index_variance[i] = Math.abs(peak_index_smoothed[i] - peak_index_smoothed2[i]);
        series.bin_sos[i] = (series.signal_over_background[i] > 1.2);
        series.bin_d3[i] = (series.peak_ismoothed_d3[i] < 80);
    }
    //series.hann11 = hann11;
    //series.vorbis71 = vorbis71;
    series.peak_index_variance = peak_index_variance;
    series.peak_index_smoothed = peak_index_smoothed;
    return series;
}

var USE_CALL_RATIO = true;
var CALL_RATIO_THRESHOLD_LEFT = 1.3;
var CALL_RATIO_THRESHOLD_RIGHT = 1.1;
var CALL_DIFF_THRESHOLD_LEFT = 1.4;
var CALL_DIFF_THRESHOLD_RIGHT = 1.0;
var TARGET_LENGTH = 0.72;
var TARGET_GAP = 0.24;
var TARGET_LEFT = 0.28;
var TARGET_RIGHT = 0.20;
var THRESHOLD_MAYBE = 1.2;
var THRESHOLD = 2;
var STOP_TRYING_THRESHOLD = 50;
var MAX_RIGHT_SEARCH = 0.6; /*biggest syllable gap in seconds*/


function analyse_call(series, l_start, l_stop, r_start, r_stop){
    var jumpiness = 0;
    var i;
    var l_len = l_stop - l_start;
    var r_len = r_stop - r_start;
    for (i = l_start; i < l_stop; i++){
        jumpiness += series.peak_index_d3[i];
    }
    for (i = r_start; i < r_stop; i++){
        jumpiness += series.peak_index_d3[i];
    }
    jumpiness /= (l_len + r_len);
    var intensity_left = 0;
    for (i = l_start; i < l_stop; i++){
        intensity_left += series.signal_over_background[i];
    }
    intensity_left /= l_len;
    var intensity_right = 0;
    for (i = r_start; i < r_stop; i++){
        intensity_right += series.signal_over_background[i];
    }
    intensity_right /= r_len;
    if (0){
        console.log('jumpiness', jumpiness, 'intensity_left', intensity_left,
            'intensity_right', intensity_right);
    }
    var score = jumpiness * 2e-4;
    score += 0.9 / intensity_left;
    score += 0.5 / intensity_right;
    return score;
}


function find_calls_in_call_diff(series, threshold_left, threshold_right,
    windows_per_second){
    var i, j;
    var samples = series.signal_over_background;
    var samples2secs = 1 / windows_per_second;
    var left_calls = [];
    var prev = -1, start = -1;
    if (samples[0] > threshold_left){
        start = 0;
        prev = 0;
    }
    for (i = 1; i < samples.length; i++){
        if (samples[i] > threshold_left){
            if (i - 1 != prev){
                /* a discontinuity */
                if (start >= 0){
                    left_calls.push([start, prev + 1]);
                }
                start = i;
            }
            prev = i;
        }
    }
    if (prev  == i - 1){
        left_calls.push([start, i]);
    }

    var candidates = [];
    var max_right_search = parseInt(MAX_RIGHT_SEARCH * windows_per_second);

    for (i = 0; i <  left_calls.length; i++){
        var l_start = left_calls[i][0];
        var l_stop = left_calls[i][1];
        var in_call = false;
        var r_start, r_stop;
        var max_i = l_stop + 1;
        var max = samples[max_i];
        for (j = l_stop + 2;
             j < samples.length && j < l_stop + max_right_search;
             j++){
            if (samples[j] > max){
                max = samples[j];
                max_i = j;
            }
        }
        /*search out from max to find drop below threshold */
        for (r_start = max_i;
             r_start > l_stop + 2;
             r_start--){
            if (samples[r_start] < threshold_right){
                break;
            }
        }
        for (r_stop = max_i;
             r_stop < max_i + max_right_search;
             r_stop++){
            if (samples[r_stop] < threshold_right){
                r_stop++;
                break;
            }
        }
        var left_start = l_start * samples2secs;
        var left_stop = l_stop * samples2secs;
        var right_start = r_start * samples2secs;
        var right_stop = r_stop * samples2secs;
        var overall_err = Math.pow(right_stop - left_start - TARGET_LENGTH, 2);
        var left_err = Math.pow(left_stop - left_start - TARGET_LEFT, 2);
        var gap_err = Math.pow(right_start - left_stop - TARGET_GAP, 2);
        var right_err = Math.pow(right_stop - right_start - TARGET_RIGHT, 2);
        var magic_err = analyse_call(series, l_start, l_stop, r_start, r_stop);
        var err = overall_err * 4 + left_err * 2 + gap_err * 2 + right_err + magic_err;
        if(0){
            console.log(left_start, right_stop, err, overall_err, left_err,
                        gap_err, right_err, magic_err);
        }
        candidates.push({
                score: err,
                left_sec: left_start,
                right_sec: right_stop,
                left_pix: l_start,
                right_pix: r_stop,
                selected: err < THRESHOLD_MAYBE
        });
    }
    candidates.sort(function(a, b){return a.score - b.score});
    console.log('candidates', candidates);
    var winners = [];
    for (i = 0; i < candidates.length; i++){
        var c = candidates[i];
        if (c.score > THRESHOLD){
            break;
        }
        var fail = false;
        for (j = 0; j < winners.length; j++){
            var w = winners[j];
            if (c.left_pix < w.right_pix && c.right_pix > w.left_pix){
                console.debug(c, ' overlaps with ', w);
                fail = true;
                break;
            }
        }
        if (! fail){
            winners.push(c);
        }
    }
    winners.sort(function(a, b){return a.left_pix - b.left_pix});
    return winners;
}

function morepork_debug(series){
    var i, j;
    console.time('morepork debug');
    var canvas = document.getElementById("debug");
    var context = canvas.getContext('2d');
    var colours = ['#FFFF00', '#FFaa00', '#00cc00', '#FF0011', '#00FFFF', '#FF33FF'];
    var keys = Object.keys(series);
    keys.sort();
    var step = canvas.height / keys.length;
    context.fillStyle = "#ffffff";

    for (j = 0; j < keys.length; j++){
        var attr = keys[j];
        var array = series[attr];
        var colour = colours[j % colours.length];
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
    console.timeEnd('morepork debug');
}

function morepork_detector(spectrogram, lower_freq, upper_freq){
    var i, j;
    console.time('morepork intensity');
    var series = get_morepork_intensity(spectrogram, lower_freq, upper_freq);
    console.timeEnd('morepork intensity');

    var winners;
    if (USE_CALL_RATIO){
        winners = find_calls_in_call_diff(series,
        CALL_RATIO_THRESHOLD_LEFT,
        CALL_RATIO_THRESHOLD_RIGHT, spectrogram.windows_per_second);
    }
    else {
        winners = find_calls_in_call_diff(series.signal_minus_background,
        CALL_DIFF_THRESHOLD_LEFT,
        CALL_DIFF_THRESHOLD_RIGHT, spectrogram.windows_per_second);
    };
    console.log('winners', winners);
    if (MOREPORK_DEBUG){
        series.all_winners = new Float32Array(spectrogram.width);
        for (i = 0; i < winners.length; i++){
            var w = winners[i];
            for (j = w.left_pix ; j < w.right_pix; j++){
                series.all_winners[j] = THRESHOLD - w.score;
            }
        }
        morepork_debug(series);
    }
    else {
        var el = document.getElementById("debug");
        el.style.display = "none";

    }
    return winners;
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
            var v2 = s[i * squash] * 1;
            var v = Math.sqrt(v2 + 1e-5);
            var v3 = v2 * v;
            var v4 = v2 * v2;
            pixels[o] = (v2 + v4 * 2e5) * 7e4;
            pixels[o + 1] = (0.2 * v + 70 * v2 + 5e3 * v3) * 7e3;
            pixels[o + 2] = (v - v3 * 1e4 + v4 * 5e6 - v * v4 * 3e8) * 3e3;
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


function draw_one_morepork(m, row_height, erase){
    var canvas = document.getElementById('drawing');
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var l_row = parseInt(m.left_pix / width);
    var l_col = parseInt(m.left_pix % width);
    var r_row = parseInt(m.right_pix / width);
    var r_col = parseInt(m.right_pix % width);
    var y;
    var cross_bar = 40 - 30 * m.score / THRESHOLD;
    var comp_op = context.globalCompositeOperation;
    var colour = m.selected ? "#33ff00" : "#ff0000";
    if (erase){
        //colour = "rgba(255,255,255,255)";
        colour = "#ffffff";
        context.globalCompositeOperation = "destination-out";
    }
    context.beginPath();
    context.strokeStyle = colour;
    context.lineWidth = 1.5;
    if (l_row == r_row){
        y = (l_row + 1) * row_height;
        context.moveTo(l_col, y - 50);
        context.lineTo(l_col, y - 10);
        context.lineTo(r_col, y - 10);
        context.lineTo(r_col, y - 50);
        context.moveTo(l_col, y - cross_bar);
        context.lineTo(r_col, y - cross_bar);
    }
    else {
        /*It should be safe to assume right row is next row - i.e.
         the call is less than 1 minute long */
        y = (l_row + 1) * row_height;
        context.moveTo(l_col, y - 50);
        context.lineTo(l_col, y - 10);
        context.lineTo(width, y - 10);
        context.moveTo(0, y - 10);
        context.lineTo(r_col, y - 10);
        context.lineTo(r_col, y - 50);
    }
    context.stroke();
    context.globalCompositeOperation = comp_op;
}

function draw_moreporks(moreporks, row_height, width_in_seconds){
    var i, j;

    for (i = 0; i < moreporks.length; i++){
        var m = moreporks[i];
        draw_one_morepork(m, row_height);
    }

}

function fill_canvas(audio, native_audio){
    var fftcanvas = document.getElementById('fft');
    var topcanvas = document.getElementById('drawing');
    var context = fftcanvas.getContext('2d');
    var width = fftcanvas.width;
    var width_in_seconds = 60;

    var pixel2sec = width_in_seconds / width;
    var row_height = 160;
    var height = Math.ceil(audio.samples.length / audio.samplerate /
                           width_in_seconds) * row_height;
    fftcanvas.height = height;
    topcanvas.height = height;
    var audio_source;
    var window_size = 1024;
    var spacing = width_in_seconds * audio.samplerate / width;

    console.time('calculate_spectrogram');
    var spectrogram = calculate_spectrogram(audio, window_size, spacing);
    console.timeEnd('calculate_spectrogram');
    var pixels = paint_spectrogram(spectrogram, fftcanvas, row_height,
                                   width_in_seconds, 600, 1500, 1);

    console.log(spectrogram);

    var LOWER_FREQ = 700;
    var UPPER_FREQ = 1100;

    console.time('morepork_detector');
    var moreporks = morepork_detector(spectrogram, LOWER_FREQ, UPPER_FREQ);
    console.timeEnd('morepork_detector');

    draw_moreporks(moreporks, row_height, width_in_seconds);


    var drawing = 0;
    var playing_column = 0;
    var playing_row = 0;
    var hidden_data;
    var playing_column_interval;

    function advance_playing_line(){
        context.putImageData(hidden_data, playing_column, playing_row * row_height);
        playing_column++;
        if (playing_column >= width){
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

    function start_playing_at_pos(p){
        stop_playing();
        audio_source = audio_context.createBufferSource();
        audio_source.buffer = native_audio;
        audio_source.connect(audio_context.destination);
        var row = parseInt(p / topcanvas.width);
        var col = parseInt(p % topcanvas.width);
        audio_source.start(0, col * pixel2sec + row * width_in_seconds);
        if (hidden_data !== undefined && playing_column !== undefined){
            context.putImageData(hidden_data, playing_column, playing_row * row_height);
        }
        playing_column = col;
        playing_row = row;
        context.fillStyle = "#ff3";
        hidden_data = context.getImageData(col, row * row_height, 1, row_height);
        context.fillRect(col, row * row_height, 1, row_height);
        playing_column_interval = window.setInterval(advance_playing_line,
                                                     pixel2sec * 1000);
        audio_source.onended = function(id){
            return function(){
                window.clearInterval(id);
            };
        }(playing_column_interval);
    }



    function get_pos(e){
        var position = topcanvas.getBoundingClientRect();
        var x = e.clientX - position.left;
        var y = e.clientY - position.top;
        var row = parseInt(y / row_height);
        var pos =  {
            x: x,
            y: y,
            row: row,
            ry: parseInt(y % row_height),
            pos: row * topcanvas.width + x
        };
        return pos;
    }

    topcanvas.onclick = function(e){
        var p = get_pos(e);
        console.log(p);
        if (p.ry < row_height - 40){
            start_playing_at_pos(p.pos);
        }
        else {
            var m = undefined;
            for (var i = 0; i < moreporks.length; i++){
                var mm = moreporks[i];
                if (p.pos >= mm.left_pix && p.pos <= mm.right_pix){
                    m = mm;
                    break;
                }
            }
            if (m === undefined){
                if (e.ctrlKey){
                    var left = p.pos - 7, right = p.pos + 7;
                    moreporks.push({
                        score: THRESHOLD,
                        left_sec: left * pixel2sec,
                        right_sec: right * pixel2sec,
                        left_pix: left,
                        right_pix: right,
                        selected: 1
                    });
                }
            }
            else if (e.ctrlKey){
                draw_one_morepork(m, row_height, 1);
                m.right_pix++;
                m.right_sec = m.right_pix * pixel2sec;
                draw_one_morepork(m, row_height);
            }
            else if (e.altKey || e.metaKey){
                draw_one_morepork(m, row_height, 1);
                m.right_pix--;
                m.right_sec = m.right_pix * pixel2sec;
                if (m.right_pix - m.left_pix < 5){
                    moreporks.splice(i, 1);
                }
                else{
                    draw_one_morepork(m, row_height);
                }
            }
            else {
                draw_one_morepork(m, row_height, 1);
                m.selected = ! m.selected;
                draw_one_morepork(m, row_height);
            }
        }
        e.preventDefault();
    };

    var drag_start_pos;
    var draggee;
    topcanvas.onmousedown = function(e){
        var p = get_pos(e);
        if (e.shiftKey && p.ry > row_height - 40){
            for (var i = 0; i < moreporks.length; i++){
                var m = moreporks[i];
                if (p.pos >= m.left_pix && p.pos <= m.right_pix){
                    console.log("beginning shift");
                    m.selected = ! m.selected;
                    draw_one_morepork(m, row_height, 1);
                    drag_start_pos = p.pos;
                    draggee = m;
                    break;
                }
            }
        }
    };

    document.onmouseup = function(e){
        var p = get_pos(e);
        if(drag_start_pos !== undefined){
            console.log("ending shift");
            var d = p.pos - drag_start_pos;
            draggee.left_pix += d;
            draggee.right_pix += d;
            draggee.left_sec = draggee.left_pix * pixel2sec;
            draggee.right_sec = draggee.right_pix * pixel2sec;
            draw_one_morepork(draggee, row_height);
            draggee = undefined;
            drag_start_pos = undefined;
        }
    };

    document.onkeypress = function(e){
        var c = String.fromCharCode(e.charCode);
        if (c == ' ' || c == 'p'){
            if (audio_source === undefined){
                start_playing_at_pos(playing_column + playing_row * topcanvas.width);
            }
            else {
                stop_playing();
            }
            e.preventDefault();
        }
    };
    var save_button = document.getElementById('save-button');
    save_button.onclick = function(e){
        var i;
        var msg = '';
        moreporks.sort(function(a, b){return a.left_pix - b.left_pix});
        for (i = 0; i < moreporks.length; i++){
            var m = moreporks[i];
            if (m.selected){
                msg += m.left_sec.toFixed(2) + ',' + m.right_sec.toFixed(2) + ',';
            }
        }
        document.getElementById('moreporks').value=msg;
        console.log(msg);
        document.getElementById('form').submit();
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
