#!/usr/bin/python

import random, re
import anydbm
import os, sys

from flask import Flask, render_template, request, make_response
app = Flask(__name__)

IGNORED = 'ignored'

PENDING_FILES = set()

WAV_DIR = 'static/wav'
#WAV_DIR = 'static/wav-test'

MOREPORKS_FOUND = 0
FILES_PROCESSED = 0
FILES_IGNORED = 0

def set_up_dbm_and_file_list():
    global DB, FILES, MOREPORKS_FOUND, FILES_PROCESSED, FILES_IGNORED
    DB = anydbm.open('moreporks.dbm', 'c')
    # sync with filesystem on start up
    for dirpath, dirnames, filenames in os.walk(WAV_DIR, followlinks=True):
        d = re.sub(WAV_DIR + '/?', '', dirpath)
        for fn in filenames:
            if fn.endswith('.wav'):
                if d:
                    fn = d + '/' + fn
                if fn not in DB:
                    PENDING_FILES.add(fn)

    for fn, moreporks in DB.iteritems():
        if moreporks == IGNORED:
            FILES_IGNORED += 1
        else:
            FILES_PROCESSED += 1
            MOREPORKS_FOUND += moreporks.count(' ') // 2
            ffn = os.path.join(WAV_DIR, fn)
            if not os.path.exists(ffn):
                print >> sys.stderr, "%s is missing" % ffn

set_up_dbm_and_file_list()


def save_results():
    global FILES_PROCESSED, FILES_IGNORED, MOREPORKS_FOUND
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
    morepork_string = get('moreporks')
    if morepork_string is None:
        morepork_times = []
    else:
        morepork_times = [x for x in morepork_string.encode('utf-8').split(',')
                          if re.match('\d+(\.\d+)?', x)]
    FILES_PROCESSED += 1
    MOREPORKS_FOUND += len(morepork_times) // 2
    DB[wav] = ' '.join(morepork_times)
    return "saved %d moreporks in %s" % (len(morepork_times) / 2, wav)


@app.route('/', methods=['GET', 'POST'])
def main_page():
    msg = save_results()
    if PENDING_FILES:
        wav = random.sample(PENDING_FILES, 1)[0]
    else:
        wav = None
    return render_template('audio.html', wav=wav, wavdir=WAV_DIR, msg=msg,
                           files_remaining=len(PENDING_FILES),
                           files_processed=FILES_PROCESSED, files_ignored=FILES_IGNORED,
                           moreporks_found=MOREPORKS_FOUND)

@app.route('/results.txt')
def results():
    #this bizarre sorting happens here because unsorted values have
    #already got into the database.
    lines = []
    for k, v in DB.iteritems():
        if v == IGNORED:
            continue
        floats = [float(x) for x in v.split()]
        pairs = []
        while floats:
            pairs.append(floats[:2])
            del floats[:2]
        pairs.sort()
        s = ' '.join('%s %s' % tuple(x) for x in pairs)
        lines.append(k + ' ' + s)

    response = make_response('\n'.join(lines))
    response.headers["content-type"] = "text/plain"
    return response



if True:
    app.run(debug=True)
else:
    app.run(host='0.0.0.0')
