#!/usr/bin/python

import random, re
import anydbm
import os, sys

from flask import Flask, render_template, request, make_response
app = Flask(__name__)

IGNORED = 'ignored'
INTERESTING = 'interesting'

PENDING_FILES = set()

WAV_DIR = 'static/wav'
IGNORED_WAV_DIRS = ('doc-kiwi',
                    'doc-morepork', 'rfpt-15m',
                    'doc-minutes',
                    'doc-interesting',
                    'doc-weka',
                )
#WAV_DIR = 'static/wav-test'

CALLS_FOUND = 0
FILES_PROCESSED = 0
FILES_IGNORED = 0
FILES_INTERESTING = 0
UNCONFIRMED_TIMES = {}

DEFAULT_DBM_FILE = 'calls.dbm'

def gen_times_from_file(fn):
    f = open(fn)
    for line in f:
        line = line.strip()
        if ' ' in line:
            wav, times = line.split(None, 1)
            yield (wav, sanitise_times(times))
        else:
            yield (wav, [])
    f.close()


def load_from_files(fn, ignored=None):
    """This is for when the database crashes."""
    if ignored:
        f = open(ignored)
        for line in f:
            line = line.strip()
            if line:
                DB[line] = IGNORED
        f.close()
    for wav, times in gen_times_from_file(fn):
        DB[wav] = ' '.join(times)

def set_up_dbm_and_file_list(dbm_file, included_wav_dirs=[]):
    global DB, FILES, CALLS_FOUND, FILES_PROCESSED, FILES_IGNORED, FILES_INTERESTING
    DB = anydbm.open(dbm_file, 'c')
    # sync with filesystem on start up
    for dirpath, dirnames, filenames in os.walk(WAV_DIR, followlinks=True):
        d = re.sub(WAV_DIR + '/?', '', dirpath)
        if included_wav_dirs:
            if d not in included_wav_dirs:
                continue
        elif d in IGNORED_WAV_DIRS:
            print d
            continue
        for fn in filenames:
            if fn.endswith('.wav'):
                if d:
                    fn = d + '/' + fn
                try:
                    if fn not in DB:
                        PENDING_FILES.add(fn)
                except:
                    print >>sys.stderr, "couldn't add %s, stupid dbm" % fn

    for fn, calls in DB.iteritems():
        if calls == IGNORED:
            FILES_IGNORED += 1
        else:
            FILES_INTERESTING += calls.startswith(INTERESTING)
            FILES_PROCESSED += 1
            CALLS_FOUND += calls.count(' ') // 2
            ffn = os.path.join(WAV_DIR, fn)
            if not os.path.exists(ffn):
                print >> sys.stderr, "%s is missing" % ffn

    #load_from_files('times/results-319.txt', 'times/ignored-319.txt')
    DB.sync()


def sanitise_times(times):
    if not times:
        return []
    if isinstance(times, (str, unicode)):
        times = times.encode('utf-8').strip()
        if ',' in times:
            times = times.split(',')
        else:
            times = times.split()
    if times[0] == INTERESTING:
        times = times[1:]
    if not times:
        return []
    times = [float(x) for x in times if x]
    if len(times) & 1:
        raise ValueError("len(times) is odd: %d" % len(times))

    #so, now times is a possibly empty list of floats
    #split it into pairs
    pairs = [times[i : i + 2] for i in range(0, len(times), 2)]
    for s, e in pairs:
        if e < s:
            raise ValueError("pair %s,%s has end before start" % (s, e))
    pairs.sort()
    ls, le = pairs[0]
    combined = []
    for i in range(1, len(pairs)):
        rs, re = pairs[i]
        if rs <= le: #overlap --> merge
            le = re
        else:
            combined.append(ls)
            combined.append(le)
            ls = rs
            le = re
    combined.append(ls)
    combined.append(le)
    return combined


def save_results():
    global FILES_PROCESSED, FILES_IGNORED, CALLS_FOUND, FILES_INTERESTING
    if request.method == 'POST':
        get = request.form.get
    else:
        get = request.args.get
    wav = get('wav')
    if wav is None:
        return "Hello!"
    wav = wav.encode('utf-8')
    if not wav in PENDING_FILES:
        return "wav file '%s' is unknown" % wav
    if get('skip'):
        return "Skipped '%s'" % wav
    PENDING_FILES.discard(wav)
    if get('ignore'):
        DB[wav] = IGNORED
        FILES_IGNORED += 1
        return "added '%s' to ignored list" % wav
    call_string = get('calls')
    call_times = sanitise_times(call_string)
    time_string = ' '.join("%.2f" % x for x in call_times)
    if get('interesting'):
        FILES_INTERESTING += 1
        interesting_string = INTERESTING + ' '
    else:
        interesting_string = ''
    FILES_PROCESSED += 1
    CALLS_FOUND += len(call_times) // 2
    DB[wav] = interesting_string + time_string
    DB.sync()
    return "saved %d calls in %s" % (len(call_times) / 2, wav)

def get_known_calls(wav):
    return UNCONFIRMED_TIMES.get(wav, [])

@app.route('/', methods=['GET', 'POST'])
def main_page():
    msg = save_results()
    if PENDING_FILES:
        wav = random.sample(PENDING_FILES, 1)[0]
    else:
        wav = None
    known_calls = ','.join(str(x) for x in get_known_calls(wav))
    return render_template('audio.html', wav=wav, wavdir=WAV_DIR, msg=msg,
                           files_remaining=len(PENDING_FILES),
                           files_processed=FILES_PROCESSED, files_ignored=FILES_IGNORED,
                           files_interesting=FILES_INTERESTING,
                           calls_found=CALLS_FOUND, known_calls=known_calls,
                           species=SPECIES)

@app.route('/results.txt')
def results():
    lines = []
    ignored = []
    interesting = []
    for k, v in DB.iteritems():
        if v == IGNORED:
            ignored.append(k)
        else:
            if v.startswith(INTERESTING):
                interesting.append(k)
            s = ' '.join('%s' % x for x in sanitise_times(v))
            lines.append("%s %s\n" % (k, s))

    lines.sort()
    text = ''.join(lines)
    f = open('results-%d.txt' % len(lines), 'w')
    f.write(text)
    f.close()
    f = open('ignored-%d.txt' % len(lines), 'w')
    f.write('\n'.join(ignored) + '\n')
    f.close()
    f = open('interesting-%d.txt' % len(lines), 'w')
    f.write('\n'.join(interesting) + '\n')
    f.close()

    response = make_response(text)
    response.headers["content-type"] = "text/plain"
    DB.sync()

    return response


def main():
    global SPECIES, UNCONFIRMED_TIMES, DB
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('-t', '--load-times',
                        help='load times from here')
    parser.add_argument('-s', '--species', default='morepork',
                        help='species to search for (morepork|weka)')
    parser.add_argument('--world-visible', action='store_true',
                        help='Allow connections from beyond localhost')
    parser.add_argument('--dbm-file', default=DEFAULT_DBM_FILE,
                        help='Use this DBM file')
    parser.add_argument('--include-wav-dir', action='append',
                        help='Use files from this subdirectory of %s' % WAV_DIR)

    args = parser.parse_args()
    if args.load_times:
        for wav, times in gen_times_from_file(args.load_times):
            if times:
                UNCONFIRMED_TIMES[wav] = times
    SPECIES = args.species

    try:
        set_up_dbm_and_file_list(args.dbm_file, included_wav_dirs=args.include_wav_dir)
        if not args.world_visible:
            app.run(debug=True)
        else:
            app.run(host='0.0.0.0')
    except Exception, e:
        print e
    finally:
        DB.close()


if __name__ == '__main__':
    main()
