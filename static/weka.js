var SPECTROGRAM_TOP = 2300;
var SPECTROGRAM_BOTTOM = 1150;

var THRESHOLD = 2;

function call_detector(spectrogram, lower_freq, upper_freq){
    var i, j;
    var winners = [];
    for (i = 0; i < KNOWN_CALLS.length; i += 2){
        winners.push({
                score: THRESHOLD,
                left_pix: KNOWN_CALLS[i] * spectrogram.windows_per_second,
                right_pix: KNOWN_CALLS[i + 1] * spectrogram.windows_per_second,
                selected: 1
        });
    }
    return winners;
}
