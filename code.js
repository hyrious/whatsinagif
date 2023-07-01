////////////////////////////////////
// Input

function $(s) { return document.querySelector(s) }

var $drop = $('#drop'),
    $home = $('#home'),
    $open = $('#open'),
    $example = $('#example'),
    $input = null,
    $output = $('#output'),
    dragging = 0,
    gif = null,
    raf = 0

function is_dragging_files(e) {
  return e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
}

document.ondragover = function (ev) {
  ev.preventDefault()
}

document.ondragenter = function enter(ev) {
  ev.preventDefault()
  if (is_dragging_files(ev)) {
    $drop.style.display = ''
    dragging++
  }
}

document.ondragleave = function leave(ev) {
  ev.preventDefault()
  if (is_dragging_files(ev)) {
    if (--dragging === 0) $drop.style.display = 'none'
  }
}

document.ondrop = function drop(ev) {
  ev.preventDefault()
  $drop.style.display = 'none'
  dragging = 0
  if (ev.dataTransfer && ev.dataTransfer.files) from_files(ev.dataTransfer.files)
}

document.onpaste = function load_from_clipboard(ev) {
  if (ev.clipboardData && ev.clipboardData.files) from_files(ev.clipboardData.files)
}

$open.onclick = async function load_from_file() {
  if (typeof showOpenFilePicker < 'u') {
    try {
      var handles = await showOpenFilePicker({
        types: [{
          description: 'GIF Images',
          accept: { 'image/gif': ['.gif'] }
        }],
        excludeAcceptAllOption: true,
        multiple: false
      })
      var h_file = handles[0]
      var blob = await h_file.getFile()
      var buffer = await blob.arrayBuffer()
      decode(buffer)
    } catch (err) {
      if ((err + '').includes('Abort')) return;
      console.error(err)
    }
  } else {
    if ($input) document.body.removeChild($input);
    $input = document.createElement('input')
    $input.type = 'file'
    $input.style.display = 'none'
    document.body.appendChild($input)
    $input.click()
    $input.onchange = function from_input() {
      from_files(this.files)
    }
  }
}

$example.onclick = async function load_example() {
  var res = await fetch(this.dataset.src)
  if (res.ok) {
    var buffer = await res.arrayBuffer()
    decode(buffer)
    return
  }
  var error = await res.text()
  alert(error)
}

async function from_files(files) {
  if (files.length === 0) {
    return
  }
  if (files.length > 1) {
    alert('Only support one file at a time, you just input ' + files.length)
    return
  }
  var buffer = await files[0].arrayBuffer()
  decode(buffer)
}

////////////////////////////////////
// Decode

function indexError(index, bounds) {
  return new Error('IndexError: index ' + index + ' outside of array bounds: ' + bounds)
}

function argumentError(error, expecting, got) {
  return new Error('ArgumentError: ' + error + ', expecting ' + expecting + ', got ' + got)
}

// Only handles a short ASCII string
function str(u8, start, length) {
  if (0 <= start && start + length < u8.byteLength) {
    return String.fromCharCode.apply(this, u8.subarray(start, start + length))
  } else {
    throw indexError([start, start + length].join('...'), [0, u8.byteLength].join('...'))
  }
}

// Get an uint16 from u8[start:start+2]
function ushort(u8, start) {
  if (0 <= start && start + 1 < u8.byteLength) {
    return u8[start] | u8[start + 1] << 8
  } else {
    throw indexError([start, start + 1], [0, u8.byteLength].join('...'))
  }
}

// Get an uint8 from u8[start]
function uchar(u8, start) {
  if (0 <= start && start < u8.byteLength) {
    return u8[start]
  } else {
    throw indexError(start, [0, u8.byteLength].join('...'))
  }
}

function GifBlock(type, from, to) {
  this.type = type
  this.from = from
  this.to   = to
}

function decode_(buffer) {
  var u8 = new Uint8Array(buffer), p = 0, info = Object.create(null)
  info.blocks = []

  function push_block(type, from, to) {
    info.blocks.push(new GifBlock(type, from, to))
  }

  // - Header
  var header = str(u8, p, 6)
  if (header !== 'GIF89a' && header !== 'GIF87a') {
    throw argumentError('Invalid GIF header', '"GIF89a"', JSON.stringify(header))
  }
  p += 6
  push_block('header', 0, 6)

  // - Logical Screen Descriptor
  var width  = ushort(u8, p); p += 2
  var height = ushort(u8, p); p += 2
  var packed = uchar(u8, p); p += 1
  var global_palette_flag = packed >> 7
  var color_resolution = ((packed >> 4) & 0b111) + 1
  var global_is_sort = (packed >> 3) & 1
  var num_global_colors = 1 << ((packed & 0b111) + 1)
  var background_index = uchar(u8, p); p += 1
  var pixel_aspect_ratio = (uchar(u8, p) + 15) / 64; p += 1
  push_block('screen', 6, 13)

  var global_palette_offset = 0
  var global_palette_size   = 0
  if (global_palette_flag) {
    global_palette_offset = p
    global_palette_size = num_global_colors
    p += num_global_colors * 3
    push_block('global-palette', 13, p)
  }

  var frames = []

  var delay             = 0
  var transparent_index = -1
  var disposal          = 0
  var loop_count        = -1

decoding:
  while (p < u8.byteLength) {
    var block_start = p
    switch (u8[p++]) {
      // - Extensions
      case 0x21: {
        if (!(p < u8.byteLength)) {
          throw indexError(p, [0, u8.byteLength].join('...'))
        }
        switch (u8[p++]) {
          // - Application Extension
          case 0xff: {
            var block_size = uchar(u8, p); p += 1
            if (block_size !== 0x0b) {
              throw argumentError('Invalid application block size', 0x0b, block_size)
            }
            var block_type = str(u8, p, block_size); p += block_size
            if (block_type !== 'NETSCAPE2.0') {
              throw argumentError('Invalid application block type', '"NETSCAPE2.0"', JSON.stringify(block_type))
            }
            var sub_block_size = uchar(u8, p); p += 1
            if (sub_block_size !== 0x03) {
              throw argumentError('Invalid application sub block size', 0x03, sub_block_size)
            }
            var sub_block_head = uchar(u8, p); p += 1
            if (sub_block_head !== 0x01) {
              throw argumentError('Invalid application sub block head', 0x01, sub_block_head)
            }
            loop_count = ushort(u8, p); p += 2
            var term = uchar(u8, p); p += 1
            if (term !== 0) {
              throw argumentError('Invalid application block end', 0, term)
            }
            push_block('application', block_start, p)
            break
          }

          // - Graphics Control Extension
          case 0xf9: {
            var block_size = uchar(u8, p); p += 1
            if (block_size !== 0x04) {
              throw argumentError('Invalid graphics control block size', 0x04, block_size)
            }
            var packed = uchar(u8, p); p += 1
            delay = ushort(u8, p); p += 2
            transparent_index = uchar(u8, p); p += 1
            disposal = (packed >> 2) & 0b111
            var transparent_flag = packed & 1
            if (transparent_flag === 0) {
              transparent_index = -1
            }
            var term = uchar(u8, p); p += 1
            if (term !== 0) {
              throw argumentError('Invalid graphics control block end', 0, term)
            }
            push_block('control', block_start, p)
            break
          }

          // - Text, Comment
          case 0x01:
          case 0xfe: {
            var block_size = 0
            do {
              block_size = uchar(u8, p); p += 1
              p += block_size
            } while (block_size > 0)
            push_block(u8[block_start + 1] === 0xfe ? 'comment' : 'text', block_start, p)
            break
          }

          default: {
            throw argumentError('Unknown graphics control label', [0x01,0xf9,0xfe,0xff], u8[p - 1])
          }
        }
        break
      }

      // - Image Descriptor
      case 0x2c: {
        var x = ushort(u8, p); p += 2
        var y = ushort(u8, p); p += 2
        var w = ushort(u8, p); p += 2
        var h = ushort(u8, p); p += 2
        var packed = uchar(u8, p); p += 1
        var local_palette_flag = packed >> 7
        var interlace_flag = (packed >> 6) & 1
        var num_local_colors = 1 << ((packed & 0b111) + 1)
        var palette_offset = global_palette_offset
        var palette_size = global_palette_size
        push_block('image-descriptor', block_start, p)
        if (local_palette_flag) {
          palette_offset = p
          palette_size = num_local_colors
          p += num_global_colors * 3
          push_block('local-palette', palette_offset, p)
        }

        var data_offset = p
        // - Image Data
        p += 1 // lzw_min
        var block_size = 0
        do {
          block_size = uchar(u8, p); p += 1
          p += block_size
        } while (block_size > 0)
        push_block('image-data', data_offset, p)

        frames.push(new GifFrame(
          x, y, w, h,
          local_palette_flag, palette_offset, palette_size,
          data_offset, p - data_offset, transparent_index,
          interlace_flag, delay, disposal
        ))
        break
      }

      // - Trailer
      case 0x3b: {
        push_block('trailer', p - 1, p)
        break decoding
      }

      default: {
        throw argumentError('Unknown GIF block', [0x21,0x2c,0x3b], u8[p - 1])
      }
    }
  }

  if (loop_count >= 0) {
    info.loop_count = loop_count
  }
  return new GifFile(u8, frames, width, height, info)
}

function GifFile(data, frames, width, height, info) {
  this.data   = data
  this.frames = frames
  this.width  = width
  this.height = height
  this.info   = info
}

function GifFrame(x, y, width, height,
                  has_local_palette, palette_offset, palette_size,
                  data_offset, data_size,
                  transparent_index, interlace, delay, disposal) {
  this.x = x; this.y = y; this.width = width; this.height = height
  this.has_local_palette = has_local_palette
  this.palette_offset    = palette_offset
  this.palette_size      = palette_size
  this.data_offset = data_offset
  this.data_size   = data_size
  this.transparent_index = transparent_index
  this.interlace = interlace
  this.delay     = delay
  this.disposal  = disposal
}

function decode(buffer) {
  try {
    target = null
    gif = decode_(buffer)
    console.log(gif)

    $home.style.display = 'none'
    $output.textContent = ''
    cancelAnimationFrame(raf)

    refresh()
    raf = requestAnimationFrame(update)

  } catch (err) {
    console.error(err)
    alert(err + '')
  }
}

////////////////////////////////////
// Render gif into $output
// Left: tree view | Right: HEX-ASCII view like hexdump -C

function h(tag, attributes) {
  const el = document.createElement(tag);
  for (const key in attributes) {
    el.setAttribute(key, attributes[key]);
  }
  return el;
}

var $svg = document.createElementNS("http://www.w3.org/2000/svg", 'svg')
$svg.id = 'arrow'
$svg.setAttribute('fill', 'transparent')
$svg.setAttribute('stroke-width', '2')
var $path = document.createElementNS("http://www.w3.org/2000/svg", 'path')
$path.setAttribute('stroke', 'currentColor')
$svg.appendChild($path)

function refresh() {
  $output.appendChild($svg)

  var $left   = $output.appendChild(h('div', { id: 'tree' }))

  var $width  = $left.appendChild(h('a', { href: 'javascript:void 0' }))
  $width.textContent  = 'width: ' + gif.width + 'px'
  link($width,  'screen', 0, 2)

  var $height = $left.appendChild(h('a', { href: 'javascript:void 0' }))
  $height.textContent = 'height: ' + gif.height + 'px'
  link($height, 'screen', 2, 2)

  var $loop   = $left.appendChild(h('a', { href: 'javascript:void 0' }))
  if ('loop_count' in gif.info) {
    $loop.textContent = 'loop (0 = inf): ' + gif.info.loop_count
    link($loop, 'application', 16, 2)
  } else {
    $loop.hidden = true
  }

  for (var i = 0; i < gif.frames.length; ++i) {
    var frame = gif.frames[i]
    var $frame = $left.appendChild(h('a', { href: 'javascript:void 0' }))
    $frame.textContent =
      '#' + i + ' (' + [frame.x, frame.y, frame.width, frame.height] + ')\n' +
      'disposal: ' + frame.disposal + ', delay: ' +
      (frame.delay >= 100 ? (frame.delay / 100) + 's' : (frame.delay * 10) + 'ms')
    link_frame($frame, i)
  }

  var $right = $output.appendChild(h('div', { id: 'hex' }))
  for (var i = 0; i < gif.info.blocks.length; ++i) {
    var block = gif.info.blocks[i]
    var $view = $right.appendChild(h('div'))
    $view.dataset.type  = block.type
    $view.dataset.range = [block.from, block.to].join()

    if ((block.type === 'image-data' || block.type.endsWith('-palette')) && block.to - block.from > 9) {
      for (var j = block.from; j < block.from + 6; ++j) {
        var $hex = $view.appendChild(h('span'))
        $hex.dataset.offset = j + ''
        $hex.textContent = (gif.data[j] | 0x100).toString(16).slice(1)
      }
      for (var j = 0; j < 3; ++j) {
        var $hex = $view.appendChild(h('span'))
        $hex.dataset.offset = ''
        $hex.textContent = '..'
      }
      for (var j = block.to - 6; j < block.to; ++j) {
        var $hex = $view.appendChild(h('span'))
        $hex.dataset.offset = j + ''
        $hex.textContent = (gif.data[j] | 0x100).toString(16).slice(1)
      }
    }

    else {
      for (var j = block.from; j < block.to; ++j) {
        var $hex = $view.appendChild(h('span'))
        $hex.dataset.offset = j + ''
        $hex.textContent = (gif.data[j] | 0x100).toString(16).slice(1)
      }
    }
  }
}

function link(a, type, at, size) {
  a.onclick     = set_target
  a.dataset.loc = [type, at, size].join()
}

function link_frame(a, index) {
  a.onclick     = set_target
  a.dataset.loc = ['frame', index].join()
}

var target = null

function set_target() {
  if (target === this) {
    target.classList.remove('active')
    target = null
    return
  }
  target = this
  var prev = document.querySelector('.active')
  if (prev) {
    prev.classList.remove('active')
  }
  target.classList.add('active')
  focus_loc()
}

function focus_loc() {
  var loc   = target.dataset.loc.split(',')
  var type  = loc[0]
  var at    = parseInt(loc[1])
  if (type === 'frame') {
    var $blocks = document.querySelectorAll('[data-type="image-descriptor"]')
    $blocks[at].scrollIntoView({ behavior: 'smooth', block: 'center' })
  } else {
    var $view = document.querySelector('[data-type="' + type + '"]')
    $view.children[at].scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function update() {
  raf = requestAnimationFrame(update)

  if (target === null) {
    $svg.style.display = 'none'
    return
  }

  $svg.style.display = ''

  var start = target.getBoundingClientRect()
  var x0 = start.left + start.width
  var y0 = start.top + start.height / 2

  var loc  = target.dataset.loc.split(',')
  var type = loc[0]
  var at   = parseInt(loc[1])

  if (type === 'frame') {
    var $blocks = document.querySelectorAll('[data-type="image-descriptor"]')
    var $desc   = $blocks[at]
    var $end    = $desc
    do {
      $end = $end.nextElementSibling
    } while ($end && $end.dataset.type !== 'image-data')

    if ($end === null) {
      throw new Error('impossible')
    }

    var end = $desc.getBoundingClientRect()
    var x1 = end.left
    var y1 = end.top + 10

    var end2 = $end.getBoundingClientRect()

    var margin = 64
    var d = [
      'M', [x0, y0],
      'C', [(x0 + 2 * x1) / 3 + margin / 2, y0],
           [(x0 * 2 + x1) / 3 - margin / 2, y1],
           [x1, y1],
      'L', [end.left, end.top],
      'V', end2.top + end2.height - 25
    ]
  } else {
    var size = parseInt(loc[2])

    var $view = document.querySelector('[data-type="' + type + '"]')
    var end = $view.children[at].getBoundingClientRect()
    var x1 = end.left
    var y1 = end.top + end.height / 2

    var margin = 64
    var d = [
      'M', [x0, y0],
      'C', [(x0 + 2 * x1) / 3 + margin / 2, y0],
           [(x0 * 2 + x1) / 3 - margin / 2, y1],
           [x1, y1],
      'L', [end.left, end.top],
      'V', end.top + end.height
    ]

    for (var i = at; i < at + size; ++i) {
      var e = $view.children[i].getBoundingClientRect()
      d.push(
        'M', [e.left, e.top + e.height], 'H', e.left + e.width,
        'M', [e.left, e.top           ], 'H', e.left + e.width
      )
      if (i === at + size - 1) {
        d.push('V', e.top + e.height)
      }
    }
  }

  d = d.join(' ')
  if ($path.getAttribute('d') !== d) {
    $path.setAttribute('d', d)
  }
}
