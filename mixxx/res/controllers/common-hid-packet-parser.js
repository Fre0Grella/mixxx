
script.HIDDebug = function (message) {
    print("HID " + message);
}


// Standard target groups not resolved for controls
HIDTargetGroups = [
    '[Channel1]','[Channel2]','[Channel3]','[Channel4]',
    '[Sampler1]','[Sampler2]','[Sampler3]','[Sampler4]',
    '[Master]','[Effects]','[Playlist]','Flanger',
    '[Microphone]'
]

// Collection of bits in one parsed packet field
function HIDBitVector () {
    // Attributes here are the 'bits' addressed by HIDBitVector[bit_name]
}

// Add a bit to the HIDBitVector at given bit index
HIDBitVector.prototype.addBit = function(group,name,index) {
    var bit = new Object();
    bit.type = 'button';
    bit.group = group;
    bit.name = name;
    bit.index = index;
    bit.callback = undefined;
    bit.value = undefined;
    this[name] = bit;
}


// Add a bit to the HIDBitVector at given bit index
HIDBitVector.prototype.addLED = function(group,name,index) {
    var bit = new Object();
    bit.type = 'led';
    bit.group = group;
    bit.name = name;
    bit.index = index;
    bit.callback = undefined;
    bit.value = undefined;
    bit.blink = undefined;
    this[name] = bit;
}

// One HID input/output packet to register to HIDController
// name     name of packet
// header   list of bytes to match from beginning of packet
// length   packet length
// callback function to call when this packet is input and is received
//          callback is not meaningful for output packets
function HIDPacket (name,header,length,callback) {
    this.name = name;
    this.header = header;
    this.length = length;
    this.callback = callback;

    // Size of various 'pack' values in bytes
    this.packSizes = { b: 1, B: 1, h: 2, H: 2, i: 4, I: 4 };
    this.signedPackFormats = [ 'b', 'h', 'i'];
}

// Pack a field to the packet
HIDPacket.prototype.pack = function(packet,field) {
    if (field.type=='bitvector') {
        for (bit_name in field.value) {
            var bit = field.value[bit_name];
            var bit_offset = field.offset+bit.index%8;
            packet.data[bit_offset] += bit.value<<bit.index%8;
        }
        return;
    }
    if (!field.pack in this.packSizes) {
        script.HIDDebug("Error packing field: unknown pack value " + field.pack);
        return;
    }
    var signed = false;
    if (this.signedPackFormats.indexOf(field.pack)!=-1)
        signed = true;

    // TODO - implement packing anything else but unsigned byte
    packet.data[field.offset] = field.value;

}

// Parse and return the 'pack' field from field attributes. Valid values are:
//  b       signed byte
//  B       unsigned byte
//  h       signed short
//  H       unsigned short
//  i       signed integer
//  I       unsigned integer
HIDPacket.prototype.unpack = function(data,field) {
    var value = 0;
    
    if (!field.pack in this.packSizes) {
        script.HIDDebug("ERROR parsing packed value: invalid pack format " + field.pack);
        return;
    }
    var bytes = this.packSizes[field.pack];
    var signed = false;
    if (this.signedPackFormats.indexOf(field.pack)!=-1)
        signed = true;
    

    for (field_byte=0;field_byte<bytes;field_byte++) {
        if (data[field.offset+field_byte]==255 && field_byte==4)
            value += 0;
        else
            value += data[field.offset+field_byte] * Math.pow(2,(field_byte*8));
    }
    if (signed==true) {
        var max_value = Math.pow(2,bytes*8);
        var split = max_value/2-1;
        if (value>split) 
            value = value-max_value;
    }
    return value;
}

// Parse bitvector field values, returning object with the named bits set.
// Value must be a valid unsigned byte to parse, with enough bits.
HIDPacket.prototype.parseBitVector = function(field,value) {
    var bits = new Object();
    var bit;
    var new_value;
    for (var name in field.value) {
        bit = field.value[name];
        new_value = value>>bit.index&1;
        if (new_value!=bit.value) {
            bit.value = new_value;
            bits[name] = bit;
        }
    }
    return bits;
}

HIDPacket.prototype.lookupGroup = function(name,create) {
    if (this.groups==undefined)
        this.groups = new Object();
    if (name in this.groups)
        return this.groups[name];
    if (!create)
        return undefined;

    this.groups[name] = new Object();
    return this.groups[name];
}

// Lookup field matching given offset and pack
HIDPacket.prototype.lookupFieldByOffset = function(offset,pack) {
    if (!pack in this.packSizes) {
        script.HIDDebug("Unknown pack string " + pack);
        return;
    }
    var end_offset = offset + this.packSizes[pack];
    if (end_offset>this.length) {
        script.HIDDebug("Invalid offset+pack range " +
            offset + '-' + end_offset +
            " for " +  this.length + " byte packet"
        );
        return;
    }
    var group = undefined;
    var field = undefined;
    for (var group_name in this.groups) {
        group = this.groups[group_name];
        for (var field_name in group) {
            field = group[field_name];
            if (field.offset>=offset && end_offset<=field.end_offset) {
                // script.HIDDebug("LOOKUP OFFSET match field " + field_name + " offset " + field.offset +'-' + field.end_offset + " to " + offset  +'-'+ end_offset);
                return field;
            }
        }
    }
    return undefined;
}

// Return a field by group and name from the packet, or undefined
// if control could not be found
HIDPacket.prototype.lookupField = function(group,name) {
    if (!group in this.groups) {
        script.HIDDebug("PACKET " + this.name + " group not found " + group);
        return undefined;
    }
    var control_group = this.groups[group];
    if (name in control_group)
        return control_group[name];

    for (group_name in this.groups) {
        var control_group = this.groups[group_name];
        for (field_name in control_group) {
            var field = control_group[field_name];
            if (field.type!='bitvector')
                continue
            for (bit_name in field.value) {
                var bit = field.value[bit_name];
                if (bit.name==name) {
                    return field;
                }
            }
        }
    }

    return undefined;
}

// Register a numeric value to parse from input packet
// Parameters:
// group     control group name
// name      name of the field
// offset    field offset inside packet (bytes)
// pack      control packing format for unpack()
// bitmask   bitmask size, bit offset for buttons, undefined for controls
// isEncoder indicates if this is an encoder which should be wrapped and delta reported
// callback  callback function to apply to the field value, or undefined for no callback
//
HIDPacket.prototype.addControl = function(group,name,offset,pack,bitmask,isEncoder) {
    var control_group = this.lookupGroup(group,true);
    if (control_group==undefined) {
        script.HIDDebug('ERROR creating HID packet group ' + group);
        return;
    }
    if (!pack in this.packSizes) {
        script.HIDError('Unknown pack value ' + pack);
        return;
    }

    var field = this.lookupFieldByOffset(offset,pack);
    if (field!=undefined) {
        if (bitmask==undefined) {
            script.HIDDebug("ERROR trying to overwrite non-bitmask control " + group + " " + name);
            return;
        }
        var bitvector = field.value;
        bitvector.addBit(group,name,bitmask);
        return;
    }

    // Add new field to packet
    field = new Object();
    field.group = group;
    field.name = name;
    field.pack = pack;
    field.offset = offset;
    field.end_offset = offset + this.packSizes[field.pack];
    field.bitmask = bitmask;
    field.isEncoder = isEncoder;
    field.callback = undefined;
    field.ignored = false;

    var packet_max_value = Math.pow(2,this.packSizes[field.pack]*8);
    if (this.signedPackFormats.indexOf(pack)!=-1) {
        field.min = 0 - (packet_max_value/2)+1;
        field.max = (packet_max_value/2)-1;
    } else {
        field.min = 0;
        field.max = packet_max_value-1;
    }

    if (bitmask==undefined || bitmask==packet_max_value) {
        field.type = 'control';
        field.value = undefined;
        field.delta = 0;
        field.mindelta = 0;
        // script.HIDDebug("PACKET " + this.name + " registering group " + group + " field " + name);
    } else {
        // TODO - accept controls with bitmask < packet_max_value
        name = 'bitvector_' + offset;
        field.type = 'bitvector';
        field.name = name;
        var bitvector = new HIDBitVector();
        bitvector.addBit(group,name,bitmask);
        field.value = bitvector;
        field.delta = undefined;
        field.mindelta = undefined;
        // script.HIDDebug("PACKET " + this.name + " registering new bitvector in group " + group + " name " + name);
    }
    control_group[name] = field;

}

// Register a LED control field or bit to output packet
HIDPacket.prototype.addLEDControl = function(group,name,offset,pack,bitmask,callback) {
    var control_group = this.lookupGroup(group,true);
    if (control_group==undefined) {
        script.HIDDebug('ERROR creating HID packet group ' + group);
        return;
    }
    if (!pack in this.packSizes) {
        script.HIDDebug("ERROR unknonw LED control pack value " + pack);
        return;
    }
    var field = this.lookupFieldByOffset(offset,pack);
    if (field!=undefined) {
        if (bitmask==undefined) {
            script.HIDDebug("ERROR trying to overwrite non-bitmask control " + group + " " + name);
            return;
        }
        var bitvector = field.value;
        bitvector.addBit(group,name,bitmask);
        return;
    }

    var field = new Object();
    field.group = group;
    field.name = name;
    field.offset = offset;
    field.end_offset = offset + this.packSizes[field.pack];
    field.bitmask = bitmask;
    field.callback = callback;
    field.blink = undefined;

    if (bitmask==undefined || bitmask==packet_max_value) {
        field.type = 'led';
        field.value = undefined;
        field.delta = undefined;
        field.mindelta = undefined;
        // script.HIDDebug("LED CONTROL " + this.name + " registering group " + group + " field " + name);
    } else {
        // TODO - accept controls with bitmask < packet_max_value
        name = 'bitvector_' + offset;
        field.type = 'bitvector';
        field.name = name;
        var bitvector = new HIDBitVector();
        bitvector.addLED(group,name,bitmask);
        field.value = bitvector;
        field.delta = undefined;
        field.mindelta = undefined;
        // script.HIDDebug("LED BITVECTOR " + this.name + " registering new bitvector in group " + group + " name " + name);
    }
    control_group[name] = field;

}

// Set 'ignored' flag for field to given value (true or false)
HIDPacket.prototype.setIgnored = function(group,name,ignored) {
    var field = this.lookupField(group,name);
    if (field==undefined) {
        script.HIDDebug("ERROR setting ignored flag for " + group +' ' + name);
        return;
    }
    field.ignored = ignored;
}

// Adjust field's minimum delta value (changes smaller than this not reported)
HIDPacket.prototype.setMinDelta = function(group,name,mindelta) {
    field = this.lookupField(group,name);
    if (field==undefined) {
        script.HIDDebug("ERROR adjusting mindelta for " + group +' ' + name);
        return;
    }
    if (field.type=='bitvector') {
        script.HIDDebug("ERROR setting mindelta for bitvector packet does not make sense");
        return;
    }
    field.mindelta = mindelta;
}

// Register a callback to field.
HIDPacket.prototype.registerCallback = function(group,name,callback) {
    var field = this.lookupField(group,name);
    if (field==undefined) {
        script.HIDDebug("ERROR in registerCallback: field for group " + group + " name " + name + " not found");
        return;
    }
    if (field.type=='bitvector') {
        for (var bit_name in field.value) {
            if (bit_name!=name)
                continue;
            var bit = field.value[bit_name];
            bit.callback = callback;
            // script.HIDDebug("Registered callback to bitvector field " + bit.name);
        }
    } else {
        field.callback = callback;
        // script.HIDDebug("Registered callback to control field " + field.name);
    }
}

// Parse input packet fields from data. Data is expected to be a
// Packet() received from HID device.
// Returns list of changed fields with new value. BitVectors are returned as
// objects you can iterate separately.
HIDPacket.prototype.parse = function(data) {
    var field_changes = new Object();
    var group;
    var group_name;
    var field_name;
    var bit;

    for (group_name in this.groups) {
        group = this.groups[group_name];
        for (field_name in group) {
            var field = group[field_name];

            var value = this.unpack(data,field);
            if (value == undefined) {
                script.HIDDebug("Error parsing packet field value for " + group_name + ' ' + field_name);
                return;
            }

            if (field.type=='bitvector') {
                var bits = this.parseBitVector(field,value);
                for (bit in bits) {
                    var bit_value = bits[bit];
                    field_changes[bit] = bit_value;;
                }

            } else if (field.type=='control') {
                if (field.value==value)
                    continue;
                if (field.ignored==true || field.value==undefined) {
                    field.value = value;
                    continue
                }
                if (field.isEncoder) {
                    if (field.value==field.max && value==field.min) {
                        change = 1;
                        field.delta = 1;
                    } else if (value==field.max && field.value==field.min) {
                        change = 1;
                        field.delta = -1;
                    } else {
                        change = 1;
                        field.delta = value-field.value;
                    }
                    // script.HIDDebug("ENCODER " + field.name + " delta " + field.delta + " field value " + field.value + " value " + value + " min " + field.min + " field.max " + field.max);

                    field.value = value;
                } else {
                    var change = Math.abs(value-field.value);
                    field.delta = value-field.value;
                }
                if (field.mindelta==undefined || change>field.mindelta) {
                    field_changes[field.name] = field;
                    field.value = value;
                }
            }
        }
    }
    return field_changes;
}

// Send this HID packet to device
HIDPacket.prototype.send = function() {
    var offset = 0;
    var i;
    var group_name;
    var group;
    var name;
    var packet = new Packet(this.length);

    for (header_byte=0;header_byte<this.header.length;header_byte++) {
        packet.data[header_byte] = this.header[header_byte];
    }

    for (group_name in this.groups) {
        group = this.groups[group_name];
        for (var name in group) {
            var field = group[name];
            this.pack(packet,field);
        }
    }
    // script.HIDDebug("Sending " + this.name + " length " + packet.length + " bytes");
    controller.send(packet.data, packet.length, 0);
}

// HID Controller with packet parser
function HIDController () {
    this.initialized = false;
    this.activeDeck = undefined;
    this.isScratchEnabled = false;

    // Scratch parameter defaults for this.scratchEnable function
    // override for custom control
    this.scratchintervalsPerRev = 128;
    this.scratchRPM = 33+1/3;
    this.scratchAlpha = 1.0/8;
    this.scratchBeta = this.scratchAlpha /32;
    this.scratchRampOnEnable = false;
    this.scratchRampOnDisable = false;

    this.ButtonStates = { released: 0, pressed: 1};
    this.LEDColors = {off: 0x0, on: 0x7f};
    // Set to value in ms to update LEDs periodically
    this.LEDUpdateInterval = undefined;

    this.modifiers = new Object();
    this.scalers = new Object();

    // Toggle buttons
    this.toggleButtons = [ 'play', 'pfl' ]

}

// Return deck number from resolved deck name
HIDController.prototype.resolveDeck = function(group) {
    if (group==undefined)
        return undefined;
    var result = group.match(/\[Channel[0-9]+\]/);
    if (!result)
        return undefined;
    var str = group.replace(/\[Channel/,"");
    return str.substring(0,str.length-1);
}

// Map virtual deck names to real deck group, or undefined if name
// could not be resolved.
HIDController.prototype.resolveGroup = function(group) {
    var channel_name = /\[Channel[0-9]+\]/;
    if (group!=undefined && group.match(channel_name))
        return group;
    if (group=='deck' || group==undefined) {
        if (this.activeDeck==undefined)
            return undefined;
        return '[Channel' + this.activeDeck + ']';
    }
    if (this.activeDeck==1 || this.activeDeck==2) {
        if (group=='deck1') return '[Channel1]';
        if (group=='deck2') return '[Channel2]';
    }
    if (this.activeDeck==3 || this.activeDeck==4) {
        if (group=='deck3') return '[Channel3]';
        if (group=='deck4') return '[Channel4]';
    }
    return undefined;
}

// Lookup scaling function for control
HIDController.prototype.lookupScalingFunction = function(name,callback) {
    if (!name in this.scalers)
        return undefined;
    return this.scalers[name];
}

// Register packet's field callback
HIDController.prototype.registerInputCallback = function(packet,group,name,callback) {
    for (var packet_name in this.InputPackets) {
        if (packet_name!=packet)
            continue;
        var input_packet = this.InputPackets[packet_name];
        // script.HIDDebug("Registering callback to input packet " + input_packet.name);
        input_packet.registerCallback(group,name,callback);
        break;
    }
}

// Register scaling function for a numeric control name
HIDController.prototype.registerScalingFunction = function(name,callback) {
    if (!name in this.scalers)
        return;
    this.scalers[name] = callback;
}

// Register input packet type to controller
HIDController.prototype.registerInputPacket = function(input_packet) {
    var group;
    var name;
    var field;

    if (this.InputPackets==undefined)
        this.InputPackets = new Object();
    // Find modifiers and other special cases from packet fields
    for (group in input_packet.groups) {
        for (name in input_packet.groups[group]) {
            field = input_packet.groups[group][name];
            if (field.type=='bitvector') {
                for (var bit_name in field.value) {
                    var bit = field.value[bit_name];
                    if (bit.group=='modifiers') {
                        // Register modifier name
                        this.registerModifier(bit.name);
                    }
                }
            }
        }
    }
    // script.HIDDebug("Registered input packet " + input_packet.name);
    this.InputPackets[input_packet.name] = input_packet;
}

HIDController.prototype.registerModifier = function(name) {
    if (name in this.modifiers) {
        script.HIDDebug("WARNING modifier already registered: " + name);
        return;
    }
    this.modifiers[name] = undefined;
}

// Register output packet type to controller
HIDController.prototype.registerOutputPacket = function(output_packet) {
    var group;
    var name;
    var field;
    // Find LEDs from packet by 'led' type
    for (group in output_packet.groups) {
        for (name in output_packet.groups[group]) {
            field = output_packet.groups[group][name];
            if (field.type!='led')
                continue;
            this.addLED(output_packet,field);
        }
    }
    if (this.OutputPackets==undefined)
        this.OutputPackets = new Object();
    // script.HIDDebug("Registered output packet " + output_packet.name);
    this.OutputPackets[output_packet.name] = output_packet;
}

// Parse a received input packet, call processDelta for results
HIDController.prototype.parsePacket = function(data,length) {
    var packet;
    var changed_data;

    if (this.InputPackets==undefined) {
        script.HIDDebug("No input packets registered");
        return;
    }

    for (var name in this.InputPackets) {
        packet = this.InputPackets[name];
        if (packet.length!=length) {
            script.HIDDebug("Invalid packet length" + packet.length);
            continue;
        }
        // Check for packet header match against data
        for (var header_byte=0;header_byte<packet.header.length;header_byte++) {
            if (packet.header[header_byte]!=data[header_byte]) {
                packet=undefined;
                break;
            }
        }
        if (packet==undefined)
            continue;

        changed_data = packet.parse(data);
        if (packet.callback!=undefined) {
            packet.callback(packet,changed_data);
            return;
        }
        // Process named group controls
        if (packet.name=='control')
            this.processIncomingPacket(packet,changed_data);
        // Process generic changed_data packet, if callback is defined
        if (this.processDelta!=undefined)
            this.processDelta(packet,changed_data);
        return;
    }
    script.HIDDebug("Received unknown packet of " + length + " bytes");
}

// STUB for scratch control: you need to
HIDController.prototype.setScratchEnabled = function(group,status) {
    var deck = this.resolveDeck(group);
    if (status==true) {
        // script.HIDDebug("ENABLE scratch in group " + group + " deck " + deck);
        this.isScratchEnabled = true;
        engine.scratchEnable(deck,
            this.scratchintervalsPerRev,
            this.scratchRPM,
            this.scratchAlpha,
            this.scratchBeta,
            this.rampedScratchEnable
        );
    } else {
        // script.HIDDebug("DISABLE scratch in group " + group + " deck " + deck);
        this.isScratchEnabled = false;
        engine.scratchDisable(deck,this.rampedScratchDisable);
    }
}

// Process the Delta (modified fields) group controls from input 
// control packet if packet name is 'control'.
// Override in your class for more complicated functionality.
HIDController.prototype.processIncomingPacket = function(packet,delta) {
    var field;
    var value;
    var group;

    for (var name in delta) {
        if (this.ignoredControlChanges!=undefined) {
            if (this.ignoredControlChanges.indexOf(name)!=-1) {
                // script.HIDDebug('Ignore field ' + name);
                continue;
            }
        }
        field = delta[name];
        if (field.group==undefined) {
            if (this.activeDeck!=undefined)
                group = '[Channel' + this.activeDeck + ']';
        } else {
            group = field.group;
        }
        if (field.type=='button') {
            if (group=='modifiers') {
                if (!field.name in this.modifiers) {
                    script.HIDDebug("Unknown modifier ID" + field.name);
                    continue;
                }
                if (field.value==this.ButtonStates.pressed)
                    this.modifiers[field.name] = true;
                else
                    this.modifiers[field.name] = false;
                continue;
            }
            if (field.callback!=undefined) {
                field.callback(field);
                continue;
            }

            // Verify and resolve group for standard buttons
            group = field.group;
            if (HIDTargetGroups.indexOf(group)==-1) {
                if (this.resolveGroup!=undefined)
                    group = this.resolveGroup(field.group);
                if (HIDTargetGroups.indexOf(group)==-1) {
                    if (this.activeDeck!=undefined)
                        script.HIDDebug("Error resolving button group " + field.group);
                    continue;
                }
            }

            // script.HIDDebug("BUTTON processing group " + group + " name " + field.name + " state " + field.value);
            if (field.name=='jog_touch') {
                if (group!=undefined) {
                    if (field.value==this.ButtonStates.pressed) {
                        this.setScratchEnabled(group,true);
                    } else {
                        this.setScratchEnabled(group,false);
                    }
                }
                var active_group = this.resolveGroup(field.group);

            } else if (this.toggleButtons.indexOf(field.name)!=-1) {
                // script.HIDDebug("TOGGLE button " + field.name);
                if (field.value==this.ButtonStates.released)
                    continue;
                if (engine.getValue(group,field.name)) {
                    if (field.name=='play')
                        engine.setValue(group,'stop',true);
                    else
                        engine.setValue(group,field.name,false);
                } else {
                    engine.setValue(group,field.name,true);
                }
            } else if (engine.getValue(group,field.name)==false) {
                engine.setValue(group,field.name,true);

            } else {
                engine.setValue(group,field.name,false);
            }

        } else if (field.type=='control') {
            if (field.callback!=undefined) {
                // script.HIDDebug("Calling field callback for " + field.name);
                value = field.callback(field);
                continue;
            }

            if (field.name=='jog_wheel') {
                // Handle jog wheel scratching transparently
                this.jog_wheel(field);
                continue;
            }

            value = field.value;
            // Verify and resolve group
            group = field.group;

            if (HIDTargetGroups.indexOf(group)==-1) {
                if (this.resolveGroup!=undefined) {
                    group = this.resolveGroup(field.group);
                }
                if (HIDTargetGroups.indexOf(group)==-1) {
                    continue;
                }
            }

            scaler = this.lookupScalingFunction(name);
            if (scaler!=undefined) {
                // script.HIDDebug("Calling value scaler for " + name);
                value = scaler(value);
            }

            if (field.isEncoder==true) {
                // script.HIDDebug("CONTROL" + " type " + field.type + " group " + group + " name "  + name + " delta " + field.delta);
                engine.setValue(group,name,field.delta);
            } else {
                // script.HIDDebug("CONTROL" + " type " + field.type + " group " + group + " name "  + name + " value " + value);
                engine.setValue(group,name,value);
            }
        }
    }
}

HIDController.prototype.getOutputPacket = function(name) {
    if (!name in this.OutputPackets)
        return None;
    return this.OutputPackets[name];
}


// Default jog scratching function, override to change implementation
HIDController.prototype.jog_wheel = function(field) {
    var value = field.value;
    var scaler = undefined;

    if (this.isScratchEnabled==true) {
        var deck = this.resolveDeck(this.resolveGroup(field.group));
        if (deck==undefined)
            return;
        scaler = this.lookupScalingFunction('jog_scratch');
        if (scaler!=undefined)
            value = scaler(field.value);
        else
            script.HIDDebug("WARNING non jog_scratch scaler, you likely want one");
        // script.HIDDebug("SCRATCH deck " + deck + " ticks " + value);
        engine.scratchTick(deck,value);
    } else {
        var active_group = this.resolveGroup(field.group);
        if (active_group==undefined)
            return;
        scaler = this.lookupScalingFunction('jog');
        if (scaler!=undefined)
            value = scaler(field.value);
        else
            script.HIDDebug("WARNING non jog scaler, you likely want one");
        // script.HIDDebug("JOG group " + active_group + " value " + value);
        engine.setValue(active_group,'jog',value);
    }
}

HIDController.prototype.getLEDGroup = function(name,create) {
    if (this.LEDs==undefined)
        this.LEDs = new Object();
    if (name in this.LEDs)
        return this.LEDs[name];
    if (!create)
        return undefined;
    this.LEDs[name] = new Object();
    return this.LEDs[name];
}

// Add a LED to controller's list of LEDs.
// Don't call directly, let HIDPacket.addLED call this.
HIDController.prototype.addLED = function(packet,field) {
    var led_group = this.getLEDGroup(field.group,true);
    if (led_group==undefined) {
        script.HIDDebug("ERROR: group was undefined while adding LED");
        return;
    }
    led_group[field.name] = {
        group: field.group,
        name: field.name,
        packet: packet
    };
}


// Update all output packets with LEDs on device to current state.
// If from_timer is true, you can toggle LED color for blinking
HIDController.prototype.updateLEDs = function(from_timer) {
    var led;
    var group;
    var group_name;
    var led_name;
    var led_packets = [];
    var packet;

    for (group_name in this.LEDs) {
        group = this.LEDs[group_name];
        for (led_name in group) {
            led = group[led_name];
            if (from_timer)
                this.toggleLEDBlinkState(led);
            if (led_packets.indexOf(led.packet)==-1) {
                led_packets[led_packets.length] = led.packet;
            }
        }
    }
    for (led_index=0;led_index<led_packets.length;led_index++) {
        packet = led_packets[led_index];
        packet.send();
    }
}

// Toggle color of a blinking led set by setLedBlink. Called from
// updateLEDs timer, if from_timer is true.
HIDController.prototype.toggleLEDBlinkState = function(group,name) {
    led_group = this.getLEDGroup(group);
    if (led_group==undefined) {
        // script.HIDDebug("toggleLEDBlinkState: Unknown group: " + group);
        return;
    }
    var led = led_group[name];
    if (led==undefined) {
        script.HIDDebug("toggleLEDBlinkState: Unknown LED: " + name);
        return;
    }
    var field = led.packet.groups[group][name];
    if (field.blink==undefined)
        return;
    if (field.value == this.LEDColors['off']) {
        field.value = field.blink;
    } else {
        field.value = this.LEDColors['off'];
    }
}

// Set LED state to given LEDColors value, disable blinking
HIDController.prototype.setLED = function(group,name,color) {
    led_group = this.getLEDGroup(group);
    if (led_group==undefined) {
        script.HIDDebug("toggleLEDBlinkState: Unknown group: " + group);
        return;
    }
    if (led_group==undefined) {
        script.HIDDebug("setLED: LED group not found: " + group);
        return;
    }
    var led = led_group[name];
    if (led==undefined) {
        script.HIDDebug("setLED: Unknown LED: " + name);
        return;
    }
    var field = led.packet.groups[group][name];
    // Verify color string
    if ( ! color in this.LEDColors ) {
        script.HIDDebug("Invalid LED color color: " + color);
        return;
    }
    field.value = this.LEDColors[color];
    field.blink = undefined;
    led.packet.send();
}

// Set LED to blink with given color. Reset with setLED(name,'off')
HIDController.prototype.setLEDBlink = function(group,name,blink_color) {
    led_group = this.getLEDGroup(group);
    if (led_group==undefined) {
        script.HIDDebug("setLEDBlink: LED group not found: " + group);
        return;
    }
    var led = led_group[name];
    if (led==undefined) {
        script.HIDDebug("setLEDBlink: Unknown LED: " + name);
        return;
    }
    var field = led.packet.groups[group][name];
    if ( blink_color!=undefined && ! blink_color in this.LEDColors ) {
        script.HIDDebug("Invalid LED blink color: " + blink_color);
        return;
    }
    field.value = this.LEDColors['off'];
    field.blink = this.LEDColors[blink_color];
    led.packet.send();
}

