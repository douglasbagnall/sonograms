var SPECTROGRAM_TOP = 1500;
var SPECTROGRAM_BOTTOM = 550;
var LOWER_FREQ = 650;
var UPPER_FREQ = 1100;


var CALL_DEBUG = 0;

function get_call_intensity(spectrogram, lf, hf){
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
    if (isNaN(score)){
        score = THRESHOLD;
    }
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
        for (j = 0; j < winners.length; j++){
            var w = winners[j];
            if (c.left_pix < w.right_pix && c.right_pix > w.left_pix){
                //console.debug(c, ' overlaps with ', w);
                break;
            }
        }
        if (j == winners.length){
            winners.push(c);
        }
    }
    winners.sort(function(a, b){return a.left_pix - b.left_pix});
    return winners;
}

function call_debug(series){
    var i, j;
    console.time('call debug');
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
    console.timeEnd('call debug');
}

function call_detector(spectrogram){
    var i, j;
    console.time('call intensity');
    var series = get_call_intensity(spectrogram, LOWER_FREQ, UPPER_FREQ);
    console.timeEnd('call intensity');

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
    if (CALL_DEBUG){
        series.all_winners = new Float32Array(spectrogram.width);
        for (i = 0; i < winners.length; i++){
            var w = winners[i];
            for (j = w.left_pix ; j < w.right_pix; j++){
                series.all_winners[j] = THRESHOLD - w.score;
            }
        }
        call_debug(series);
    }
    else {
        var el = document.getElementById("debug");
        el.style.display = "none";

    }
    return winners;
}
