package gui
{
   import flash.display.MovieClip;
   import flash.display.Sprite;
   import flash.events.MouseEvent;
   import flash.events.TextEvent;
   import flash.geom.ColorTransform;
   import flash.geom.Point;
   import flash.geom.Rectangle;
   import flash.text.TextField;
   import flash.utils.setTimeout;
   import loader.MediaHelper;
   import localization.LocalizationManager;
   
   public dynamic class ChatBalloon extends MovieClip
   {
      
      private const CHAT_TIMEOUT_MS:int = 8000;
      
      private const BALLOON_BEGIN_FADEOUT:Number = 1000;
      
      private const BALLOON_MAX_ALPHA:Number = 0.75;
      
      private const TEXT_COLOR_NORMAL:uint = 4477529;
      
      private const TEXT_COLOR_BAD_TEXT:uint = 13369344;
      
      private var _maxAlpha:Number;
      
      private var _timeout:int = 0;
      
      private var _avType:int = 0;
      
      private var _originalFrameId:int = 0;
      
      private var _originalCustomMsgText:String;
      
      private var _emoteBG:MovieClip = null;
      
      private var _emote:Sprite = null;
      
      private var _permEmoteMediaId:int = -1;
      
      private var _permEmoteMediaHelper:MediaHelper;
      
      private var _hasSbTextfield:Boolean;
      
      private var _msgTxt:Object;
      
      private var _balloonBG:MovieClip;
      
      private var _btnBallonBG:MovieClip;
      
      private var _btnBalloonMouseBG:MovieClip;
      
      private var _btnBalloonUpBG:MovieClip;
      
      private var _btnBalloonDownBg:MovieClip;
      
      private var _btnBalloonGrayBG:MovieClip;
      
      private var _onCustomAdventureBtn:Function;
      
      private var _onCustomPVPBtn:Function;
      
      private var _emoteBGOffsetFunc:Function;
      
      // emotes drawn inside a line of chat, small, where they were typed: an
      // emote's code standing as a word of its own ("hi :) there", ":fever:"),
      // or anywhere after a "\" ("yay\:)"). and emoji (typed with Windows'
      // emoji panel, say), which the game's font has none of: each is drawn
      // as a picture of it, from the server (/emoji/<code points>.png,
      // Twemoji's). each is {at, clip}: where its gap starts in the text shown.
      // Three spaces fit the line-height-sized emoji without the noticeably
      // wide hole four spaces left between neighbouring words or emoji.
      private static const INLINE_GAP:String = "   ";
      
      private static const LONGEST_EMOTE_CODE:int = 16;
      
      private var _inline:Array = [];
      
      public function ChatBalloon()
      {
         super();
      }
      
      public function init(param1:int, param2:Function, param3:Boolean = false, param4:int = 1, param5:Number = 1, param6:Class = null, param7:Function = null, param8:Function = null) : void
      {
         if(param5 < 0.75)
         {
            this.scaleX = this.scaleY = 1 + (0.75 - param5);
         }
         _originalFrameId = param4;
         this.gotoAndStop(param4);
         _balloonBG = this["balloon_bg"];
         _msgTxt = this["message_txt"];
         _onCustomAdventureBtn = param7;
         _onCustomPVPBtn = param8;
         _emoteBGOffsetFunc = param2;
         _avType = param1;
         visible = false;
         _msgTxt.autoSize = "center";
         if(param3)
         {
            _maxAlpha = 1;
         }
         else
         {
            _maxAlpha = 0.75;
         }
         _emoteBG = GETDEFINITIONBYNAME("emo_bubble");
         setEmoteBgOffsets();
      }
      
      public function setText(param1:String, param2:Boolean = false, param3:Boolean = true) : void
      {
         if(_emote)
         {
            _permEmoteMediaId = -1;
            _emoteBG.itemWindow.removeChild(_emote);
            _emote = null;
         }
         if(contains(_emoteBG))
         {
            removeChild(_emoteBG);
         }
         if(param1 != _msgTxt.text && _hasSbTextfield)
         {
            _balloonBG.visible = false;
            setAlpha(_maxAlpha);
            this.visible = false;
         }
         else
         {
            _balloonBG.visible = true;
            setAlpha(_maxAlpha);
            this.visible = true;
         }
         clearInline();
         clearMentionBacks();
         _msgTxt.text = inlineEmotes(param1);
         _msgTxt.height;
         // AJClient.whisperNext is set by the server's "xw" just ahead of a
         // whispered line.
         _balloonBG.transform.colorTransform = AJClient.whisperNext ? AJClient.whisperTint() : new ColorTransform();
         AJClient.whisperNext = false;
         if(!_hasSbTextfield)
         {
            if(param3)
            {
               _balloonBG.m.height = Math.ceil(_msgTxt.height);
               _balloonBG.m.y = _balloonBG.b.y - _balloonBG.m.height;
               _balloonBG.t.y = _balloonBG.m.y - _balloonBG.t.height;
               _msgTxt.y = -_balloonBG.b.height - _balloonBG.m.height;
            }
            else
            {
               _balloonBG.m.height = Math.ceil(_msgTxt.height);
               _balloonBG.b.y = _balloonBG.m.y + _balloonBG.m.height;
               _msgTxt.y = _balloonBG.t.height + 3;
            }
            if(this.currentFrameLabel == "advBtn")
            {
               _btnBallonBG.y = _balloonBG.y + _balloonBG.t.y - _btnBallonBG.height + _balloonBG.t.height;
            }
         }
         if(param2)
         {
            _msgTxt.textColor = 13369344;
         }
         else
         {
            _msgTxt.textColor = 4477529;
         }
         // tags (AJClient.resolveMentions): once the server says which "@"s
         // are players', light blue and underlined, each a link to that
         // player's card, if the balloon still says the same. (the field is
         // another on some frames.)
         if(!param2 && _msgTxt is TextField && _msgTxt.text.indexOf("@") != -1)
         {
            var field:TextField = TextField(_msgTxt);
            var shown:String = field.text;
            field.addEventListener("link",onMentionLink,false,0,true);
            AJClient.resolveMentions(shown,function(param1:Array):void
            {
               if(field.text == shown)
               {
                  // in the message's own colour here: the blue box marks it
                  AJClient.styleMentions(field,param1,true,4477529);
                  // and their backgrounds, now and once laid out for sure
                  AJClient.drawMentionBacks(field,param1,AJClient.MENTION_BACK_LIGHT);
                  setTimeout(function():void
                  {
                     if(field.text == shown)
                     {
                        AJClient.drawMentionBacks(field,param1,AJClient.MENTION_BACK_LIGHT);
                     }
                  },42);
               }
            });
         }
         _timeout = 8000;
         if(param3 && this.parent)
         {
            this.parent.addChild(this);
         }
         if(_inline.length > 0)
         {
            // now, and once more when the text has been laid out for sure
            // (the game's own inline emotes, in SBTextField, wait a frame).
            placeInline();
            setTimeout(placeInline,42);
         }
      }
      
      // the text with each emote code and emoji (above) replaced by a gap, the
      // picture for it kept in _inline. what is neither stays as typed.
      private function inlineEmotes(param1:String) : String
      {
         var _loc2_:String = "";
         var _loc3_:int = 0;
         var _loc5_:String = null;
         var _loc7_:Sprite = null;
         var _loc8_:int = 0;
         while(_loc3_ < param1.length)
         {
            _loc8_ = emojiLength(param1,_loc3_);
            if(_loc8_ > 0)
            {
               _inline.push({
                  "at":_loc2_.length,
                  "clip":emojiClip(param1.substr(_loc3_,_loc8_))
               });
               _loc2_ += INLINE_GAP;
               _loc3_ += _loc8_;
               continue;
            }
            _loc5_ = null;
            // an emoji as it is sent: "\{1f600}" (AJClient.emojiToTokens)
            if(param1.substr(_loc3_,2) == "\\{")
            {
               var _loc9_:Array = /^\\\{([0-9a-f]{2,6}(?:-[0-9a-f]{2,6}){0,9})\}/.exec(param1.substr(_loc3_,90));
               if(_loc9_ != null)
               {
                  _inline.push({
                     "at":_loc2_.length,
                     "clip":emojiClipNamed(_loc9_[1])
                  });
                  _loc2_ += INLINE_GAP;
                  _loc3_ += String(_loc9_[0]).length;
                  continue;
               }
            }
            if(param1.charAt(_loc3_) == "\\")
            {
               _loc5_ = emoteCodeAt(param1,_loc3_ + 1,false);
            }
            else if(_loc3_ == 0 || param1.charAt(_loc3_ - 1) == " ")
            {
               _loc5_ = emoteCodeAt(param1,_loc3_,true);
            }
            _loc7_ = _loc5_ == null ? null : EmoticonUtility.getSmallSmileyMCForEmoteString(_loc5_);
            if(_loc7_ != null)
            {
               _loc7_.mouseEnabled = false;
               _loc7_.mouseChildren = false;
               _inline.push({
                  "at":_loc2_.length,
                  "clip":_loc7_
               });
               _loc2_ += INLINE_GAP;
               _loc3_ += (param1.charAt(_loc3_) == "\\" ? 1 : 0) + _loc5_.length;
            }
            else
            {
               _loc2_ += param1.charAt(_loc3_);
               _loc3_++;
            }
         }
         return _loc2_;
      }

      // the longest emote code at `param2`, or null. `param3`: as a word of its
      // own, so it must end the text or come before a space or a stop.
      private static function emoteCodeAt(param1:String, param2:int, param3:Boolean) : String
      {
         var _loc4_:int = Math.min(LONGEST_EMOTE_CODE,param1.length - param2);
         var _loc5_:String = null;
         var _loc6_:String = null;
         while(_loc4_ >= 2)
         {
            _loc5_ = param1.substr(param2,_loc4_);
            _loc6_ = param1.charAt(param2 + _loc4_);
            if((!param3 || _loc6_ == "" || " .,!?".indexOf(_loc6_) != -1) && EmoticonUtility.doesStringMatchAnEmote(_loc5_))
            {
               return _loc5_;
            }
            _loc4_--;
         }
         return null;
      }

      // how many UTF-16 units the emoji at `param2` takes (with its skin tone,
      // its variation selector, a keycap, a second flag letter, and whatever
      // it is joined to with a zero-width joiner), or 0 when there is none.
      public static function emojiLength(param1:String, param2:int) : int
      {
         var _loc3_:int = param1.charCodeAt(param2);
         var _loc4_:int = 0;
         var _loc5_:int = 0;
         var _loc6_:int = 0;
         var _loc7_:Boolean = false;
         if(_loc3_ >= 0xD800 && _loc3_ <= 0xDBFF)
         {
            _loc5_ = codePointAt(param1,param2);
            if(_loc5_ < 0x1F000 || _loc5_ > 0x1FAFF)
            {
               return 0;
            }
            _loc4_ = 2;
            _loc7_ = _loc5_ >= 0x1F1E6 && _loc5_ <= 0x1F1FF;
            // a flag is two letters
            if(_loc7_)
            {
               _loc6_ = codePointAt(param1,param2 + 2);
               if(_loc6_ >= 0x1F1E6 && _loc6_ <= 0x1F1FF)
               {
                  _loc4_ = 4;
               }
            }
         }
         else if(_loc3_ >= 0x2600 && _loc3_ <= 0x27BF || _loc3_ >= 0x2300 && _loc3_ <= 0x23FF || _loc3_ >= 0x2B00 && _loc3_ <= 0x2BFF
            || _loc3_ >= 0x2194 && _loc3_ <= 0x21AA || _loc3_ >= 0x25AA && _loc3_ <= 0x25FE
            || [0x203C,0x2049,0x2122,0x2139,0x24C2,0x2934,0x2935,0x3030,0x303D,0x3297,0x3299,0xA9,0xAE].indexOf(_loc3_) != -1 && param1.charCodeAt(param2 + 1) == 0xFE0F)
         {
            _loc4_ = 1;
         }
         else if("0123456789#*".indexOf(param1.charAt(param2)) != -1 && param1.charCodeAt(param2 + 1) == 0xFE0F && param1.charCodeAt(param2 + 2) == 0x20E3)
         {
            return 3;
         }
         else
         {
            return 0;
         }
         while(param2 + _loc4_ < param1.length)
         {
            _loc3_ = param1.charCodeAt(param2 + _loc4_);
            if(_loc3_ == 0xFE0F || _loc3_ == 0x20E3)
            {
               _loc4_++;
            }
            else if(_loc3_ == 0xD83C && param1.charCodeAt(param2 + _loc4_ + 1) >= 0xDFFB && param1.charCodeAt(param2 + _loc4_ + 1) <= 0xDFFF)
            {
               _loc4_ += 2;
            }
            else if(_loc3_ == 0x200D && param2 + _loc4_ + 1 < param1.length)
            {
               _loc5_ = emojiLength(param1,param2 + _loc4_ + 1);
               if(_loc5_ == 0)
               {
                  break;
               }
               _loc4_ += 1 + _loc5_;
               break;
            }
            else
            {
               break;
            }
         }
         return _loc4_;
      }

      private static function codePointAt(param1:String, param2:int) : int
      {
         var _loc3_:int = param1.charCodeAt(param2);
         var _loc4_:int = param1.charCodeAt(param2 + 1);
         if(_loc3_ >= 0xD800 && _loc3_ <= 0xDBFF && _loc4_ >= 0xDC00 && _loc4_ <= 0xDFFF)
         {
            return (_loc3_ - 0xD800) * 0x400 + (_loc4_ - 0xDC00) + 0x10000;
         }
         return _loc3_;
      }

      // its picture's name, as Twemoji names its files: the code points in
      // hex, "-" between, without U+FE0F unless it is joined (U+200D).
      public static function emojiName(param1:String) : String
      {
         var _loc2_:Array = [];
         var _loc3_:int = 0;
         var _loc4_:int = 0;
         var _loc5_:Boolean = param1.indexOf(String.fromCharCode(0x200D)) != -1;
         while(_loc3_ < param1.length)
         {
            _loc4_ = codePointAt(param1,_loc3_);
            _loc3_ += _loc4_ > 0xFFFF ? 2 : 1;
            if(_loc4_ != 0xFE0F || _loc5_)
            {
               _loc2_.push(_loc4_.toString(16));
            }
         }
         return _loc2_.join("-");
      }

      // the picture of an emoji: a 72-square, its middle on the origin (as
      // the game's small emotes are), filled when the picture has loaded.
      private static function emojiClip(param1:String) : Sprite
      {
         return emojiClipNamed(emojiName(param1));
      }

      private static function emojiClipNamed(param1:String) : Sprite
      {
         var _loc2_:Sprite = new Sprite();
         _loc2_.graphics.beginFill(0,0);
         _loc2_.graphics.drawRect(-36,-36,72,72);
         _loc2_.graphics.endFill();
         _loc2_.mouseEnabled = false;
         _loc2_.mouseChildren = false;
         AJClient.loadArt(gMainFrame.clientInfo.websiteURL + "emoji/" + param1 + ".png",_loc2_,72,false);
         return _loc2_;
      }

      // puts each inline emote over its gap, as tall as the line.
      private function placeInline() : void
      {
         var _loc1_:Object = null;
         var _loc2_:Rectangle = null;
         var _loc3_:Rectangle = null;
         for each(_loc1_ in _inline)
         {
            _loc2_ = _msgTxt.getCharBoundaries(_loc1_.at);
            _loc3_ = _msgTxt.getCharBoundaries(_loc1_.at + INLINE_GAP.length - 1);
            if(_loc2_ == null)
            {
               _loc2_ = _loc3_;
            }
            if(_loc3_ == null || _loc2_ != null && _loc3_.y != _loc2_.y)
            {
               _loc3_ = _loc2_;
            }
            if(_loc2_ != null)
            {
               _loc1_.clip.scaleX = _loc1_.clip.scaleY = 1;
               _loc1_.clip.height = _loc2_.height;
               _loc1_.clip.scaleX = _loc1_.clip.scaleY;
               _loc1_.clip.x = _msgTxt.x + (_loc2_.x + _loc3_.x + _loc3_.width) / 2;
               _loc1_.clip.y = _msgTxt.y + _loc2_.y + _loc2_.height / 2;
               if(_loc1_.clip.parent != this)
               {
                  addChild(_loc1_.clip);
               }
            }
         }
      }
      
      private function clearInline() : void
      {
         var _loc1_:Object = null;
         for each(_loc1_ in _inline)
         {
            if(_loc1_.clip.parent == this)
            {
               removeChild(_loc1_.clip);
            }
         }
         _inline = [];
      }
      
      public function setCustomAdventureMessage(param1:String, param2:String, param3:int, param4:Boolean = false, param5:Boolean = false) : void
      {
         clearMentionBacks();
         var _loc6_:int = 0;
         var _loc7_:int = 0;
         var _loc8_:Array = param2.split("|");
         if(param5)
         {
            param2 = _loc8_[0];
            _loc6_ = int(_loc8_[1]);
         }
         else
         {
            param2 = _loc8_[0];
            _loc7_ = int(_loc8_[1]);
         }
         if(param2 == "on")
         {
            if(_emote && _emoteBG)
            {
               _emoteBG.itemWindow.removeChild(_emote);
               _emote = null;
               if(contains(_emoteBG))
               {
                  removeChild(_emoteBG);
               }
            }
            if(this.currentFrameLabel != "advBtn")
            {
               this.gotoAndStop("advBtn");
            }
            _balloonBG = this["balloon_bg"];
            _btnBallonBG = this["btnBalloon_bg"];
            _btnBalloonMouseBG = _btnBallonBG.mouse.mouse;
            _btnBalloonUpBG = _btnBallonBG.mouse.up;
            _btnBalloonDownBg = _btnBallonBG.down;
            _btnBalloonGrayBG = _btnBallonBG.gray;
            _btnBallonBG.isForPVP = param5;
            _btnBallonBG.PVPGameId = _loc6_;
            _btnBallonBG.scriptDefId = _loc7_;
            _btnBallonBG.addEventListener("mouseDown",onBtnBG,false,0,true);
            _msgTxt = this["message_txt"];
            _msgTxt.autoSize = "center";
            LocalizationManager.translateId(_btnBalloonMouseBG.message_txt,11259);
            LocalizationManager.translateId(_btnBalloonUpBG.message_txt,11259);
            LocalizationManager.translateId(_btnBalloonDownBg.message_txt,11259);
            LocalizationManager.translateId(_btnBalloonGrayBG.message_txt,11259);
            if(param3 > 0)
            {
               _btnBalloonMouseBG.message_txt.x = 3;
               _btnBalloonUpBG.message_txt.x = 3;
               _btnBalloonDownBg.message_txt.x = 3;
               _btnBalloonGrayBG.message_txt.x = 3;
               _btnBallonBG["redDot"].visible = true;
            }
            else
            {
               _btnBalloonMouseBG.message_txt.x = 17;
               _btnBalloonUpBG.message_txt.x = 17;
               _btnBalloonDownBg.message_txt.x = 17;
               _btnBalloonGrayBG.message_txt.x = 17;
               _btnBallonBG["redDot"].visible = false;
            }
            _msgTxt.text = param1;
            _originalCustomMsgText = param1;
            _balloonBG.m.height = _msgTxt.height;
            _balloonBG.m.y = _balloonBG.b.y - _msgTxt.height;
            _balloonBG.t.y = _balloonBG.m.y - _balloonBG.t.height;
            _msgTxt.y = -_balloonBG.b.height - _msgTxt.height;
            _btnBallonBG.y = _balloonBG.y + _balloonBG.t.y - _btnBallonBG.height + _balloonBG.t.height;
            if(this.itemWindow)
            {
               this.itemWindow.y = _btnBallonBG.y;
            }
            _balloonBG.t.alpha = 0;
            setAlpha(_maxAlpha);
            this.visible = true;
            _timeout = 8000;
            if(this.parent)
            {
               this.parent.addChild(this);
            }
         }
         else
         {
            if(_btnBallonBG)
            {
               if(_btnBallonBG.isForPVP != param5)
               {
                  return;
               }
               _btnBallonBG.removeEventListener("mouseDown",onBtnBG);
            }
            if(this.currentFrameLabel == "advBtn")
            {
               this.gotoAndStop(_originalFrameId);
            }
            _balloonBG = this["balloon_bg"];
            _msgTxt = this["message_txt"];
            _msgTxt.autoSize = "center";
            this.visible = false;
         }
      }
      
      public function get msgTxt() : Object
      {
         return _msgTxt;
      }
      
      public function get isPvpCustom() : Boolean
      {
         if(_btnBallonBG)
         {
            return _btnBallonBG.isForPVP;
         }
         return false;
      }
      
      public function get pvpGameId() : int
      {
         if(_btnBallonBG)
         {
            return _btnBallonBG.PVPGameId;
         }
         return 0;
      }
      
      public function setCustomPVPImage(param1:MovieClip) : void
      {
         var _loc2_:Number = NaN;
         if(this.currentFrameLabel == "advBtn")
         {
            while(this.itemWindow.numChildren > 0)
            {
               this.itemWindow.removeChildAt(0);
            }
            param1 = param1.getChildAt(0) as MovieClip;
            param1.gotoAndStop("icon");
            _loc2_ = 32.5 / Math.max(param1.sizeCont.width,param1.sizeCont.height);
            param1.scaleX = param1.scaleY = _loc2_;
            param1.sizeCont.scaleX = param1.sizeCont.scaleY = _loc2_;
            param1.x += param1.sizeCont.width * 0.5;
            param1.y += param1.sizeCont.height * 0.5;
            this.itemWindow.addChild(param1);
         }
      }
      
      // the backgrounds of the tags of the text before (setText)
      private function clearMentionBacks() : void
      {
         if(_msgTxt is TextField)
         {
            AJClient.drawMentionBacks(TextField(_msgTxt),null);
         }
      }

      // a tag clicked: "@name" (setText)
      private function onMentionLink(param1:TextEvent) : void
      {
         param1.stopPropagation();
         if(param1.text && param1.text.charAt(0) == "@")
         {
            AJClient.openProfile(param1.text.substr(1));
         }
      }

      private function onBtnBG(param1:MouseEvent) : void
      {
         param1.stopPropagation();
         if(param1.currentTarget.isForPVP)
         {
            _onCustomPVPBtn(param1.currentTarget.PVPGameId);
         }
         else
         {
            _onCustomAdventureBtn(param1.currentTarget.scriptDefId);
         }
      }
      
      private function updateCustAdventureBGSize(param1:MovieClip, param2:Object) : void
      {
         _balloonBG.m.height = _msgTxt.height;
         _balloonBG.m.y = _balloonBG.b.y - _msgTxt.height;
         _balloonBG.t.y = _balloonBG.m.y - _balloonBG.t.height;
         _msgTxt.y = -_balloonBG.b.height - _msgTxt.height;
         _btnBallonBG.y = _balloonBG.y + _balloonBG.t.y - _btnBallonBG.height + _balloonBG.t.height;
         if(this.itemWindow)
         {
            this.itemWindow.y = _btnBallonBG.y;
         }
      }
      
      public function setEmote(param1:Sprite, param2:int = -1) : void
      {
         clearMentionBacks();
         if(this.currentFrameLabel != "advBtn")
         {
            _permEmoteMediaId = param2;
            if(_emote)
            {
               _emoteBG.itemWindow.removeChild(_emote);
               _emote = null;
            }
            if(_permEmoteMediaId >= 0)
            {
               param1 = new Sprite();
               _permEmoteMediaHelper = new MediaHelper();
               _permEmoteMediaHelper.init(_permEmoteMediaId,permEmoteMediaCallback);
            }
            if(param1)
            {
               _msgTxt.text = "";
               addChild(_emoteBG);
               _emote = param1;
               _emote.y = -5;
               _emoteBG.itemWindow.addChild(_emote);
               if(_emote is MovieClip)
               {
                  MovieClip(_emote).gotoAndPlay(1);
               }
               if(this.currentFrameLabel != "advBtn")
               {
                  _timeout = 8000;
               }
               _balloonBG.visible = false;
               setAlpha(1);
               _emoteBG.bubble.alpha = _maxAlpha;
               _emoteBG.itemWindow.alpha = 1;
               this.visible = true;
            }
         }
      }
      
      public function setReadyForClear() : void
      {
         if(this.visible && _timeout > 1000)
         {
            _timeout = 1000;
         }
         _permEmoteMediaId = -1;
      }
      
      public function setPos(param1:int, param2:int) : void
      {
         this.x = param1;
         this.y = param2;
      }
      
      public function heartbeat(param1:int) : void
      {
         if(_timeout && _permEmoteMediaId < 0)
         {
            if(param1 >= _timeout)
            {
               _timeout = 0;
               if(_emote)
               {
                  _emoteBG.itemWindow.removeChild(_emote);
                  _emote = null;
               }
               if(this.currentFrameLabel != "advBtn")
               {
                  this.visible = false;
               }
               else
               {
                  _msgTxt.text = _originalCustomMsgText;
                  updateCustAdventureBGSize(_balloonBG,_msgTxt);
               }
            }
            else
            {
               _timeout -= param1;
               if(this.currentFrameLabel != "advBtn" && _timeout < 1000)
               {
                  setAlpha(_timeout / 1000 * _maxAlpha);
               }
            }
         }
      }
      
      public function set avType(param1:int) : void
      {
         if(param1 != _avType)
         {
            _avType = param1;
            setEmoteBgOffsets();
         }
      }
      
      public function updateEmoteBgOffsets() : void
      {
         setEmoteBgOffsets();
      }
      
      private function setAlpha(param1:Number) : void
      {
         this.alpha = param1;
         _msgTxt.alpha = 1;
      }
      
      private function permEmoteMediaCallback(param1:MovieClip) : void
      {
         var _loc2_:int = 0;
         var _loc4_:Point = null;
         var _loc3_:Number = NaN;
         if(param1 && _emote && _permEmoteMediaId >= 0)
         {
            param1 = param1.getChildAt(0) as MovieClip;
            _loc2_ = 0;
            while(_loc2_ < param1.currentLabels.length)
            {
               if(param1.currentLabels[_loc2_].name == "icon")
               {
                  param1.gotoAndStop("icon");
                  break;
               }
               _loc2_++;
            }
            if("sizeCont" in param1)
            {
               _loc4_ = new Point(param1.sizeCont.width,param1.sizeCont.height);
            }
            else
            {
               _loc4_ = new Point(param1.width,param1.height);
            }
            _loc3_ = 30 / Math.max(_loc4_.x,_loc4_.y);
            param1.scaleX = param1.scaleY = _loc3_;
            if("sizeCont" in param1)
            {
               param1.sizeCont.scaleX = param1.sizeCont.scaleY = _loc3_;
            }
            else
            {
               param1.x -= param1.width * 0.5;
               param1.y -= param1.height * 0.5;
            }
            _emote.addChild(param1);
         }
      }
      
      private function setEmoteBgOffsets() : void
      {
         var _loc1_:Point = _emoteBGOffsetFunc(_avType);
         _emoteBG.x = _loc1_.x;
         _emoteBG.y = _loc1_.y;
      }
   }
}

